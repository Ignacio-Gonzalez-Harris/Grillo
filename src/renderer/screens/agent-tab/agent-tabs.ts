import './agent-tab.css';
import { AGENT_KINDS, type AgentId, type AgentInfo } from '../../../shared/agents';
import type { ShellContext } from '../../app/screens';
import { glassPanel } from '../../theme/components';
import type { MountedPanel, PanelSlot, TabPanel, TabPanelContext, TabPanels } from './tab-panels';

export interface AgentTabs {
  /** Shows the agent's tab content in `el`; returns the function that takes it out again (it keeps running). */
  show(el: HTMLElement, agentId: AgentId): () => void;
  /** Takes every panel down and stops following the agent tabs. */
  dispose(): void;
}

/** One running agent's panels. They live as long as the agent runs, so output and typed text survive tab changes. */
interface Session {
  root: HTMLElement;
  mounted: MountedPanel[];
  headerSlots: HTMLElement[];
}

type PanelHook = keyof MountedPanel;

function isAgentInfo(value: unknown): value is AgentInfo {
  const candidate = value as Partial<Record<keyof AgentInfo, unknown>> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.id === 'string' &&
    candidate.id !== '' &&
    (AGENT_KINDS as readonly unknown[]).includes(candidate.kind)
  );
}

/** Keeps only the hooks a panel really returned as functions; anything else it returned counts as nothing. */
function asMounted(result: unknown): MountedPanel {
  if (typeof result !== 'object' || result === null) return {};
  const hooks: MountedPanel = {};
  for (const hook of ['shown', 'setInput', 'dispose', 'endNote'] as const satisfies readonly PanelHook[]) {
    const fn: unknown = (result as Record<string, unknown>)[hook];
    if (typeof fn === 'function') hooks[hook] = fn.bind(result);
  }
  return hooks;
}

/** Runs one panel's code so that a failing panel is reported and the rest of the tab still works. */
function safely<T>(agentId: AgentId, what: string, run: () => T): T | undefined {
  try {
    return run();
  } catch (error) {
    console.error(`A tab panel of agent ${agentId} failed to ${what}; the rest of the tab still works.`, error);
    return undefined;
  }
}

function notRunning(notes: readonly string[] = []): HTMLElement {
  const lines = ['This agent is not running.', ...notes].map((text) => {
    const line = document.createElement('p');
    line.className = 'muted';
    line.textContent = text;
    return line;
  });
  const panel = glassPanel(lines);
  panel.classList.add('agent-tab-gone');
  return panel;
}

function element(tag: 'div' | 'span', className: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

/**
 * Follows the agent tabs: when a tab appears it mounts that agent's panels (the body, the controls to its left, what
 * goes above it and to its right, and the header panels inside the tab itself), and when it goes away it takes them
 * down.
 */
export function createAgentTabs(shell: ShellContext, panels: TabPanels): AgentTabs {
  const sessions = new Map<AgentId, Session>();
  /** Tabs opened before their agent was on the list: the answer to a start can reach the screen before the list does. */
  const awaited = new Map<AgentId, HTMLElement>();

  function mountPanel(agent: AgentInfo, panel: TabPanel, el: HTMLElement, context: TabPanelContext): MountedPanel {
    return asMounted(safely(agent.id, 'mount', () => panel.mount(el, context)));
  }

  function open(agent: AgentInfo): Session {
    let body: MountedPanel = {};
    const context: TabPanelContext = {
      agent: { ...agent },
      grillo: shell.grillo,
      shell,
      setInput: (text) => safely(agent.id, 'take text', () => body.setInput?.(text)),
    };

    const root = element('div', 'agent-tab');
    const bodySlot = element('div', 'agent-tab-body');
    body = mountPanel(agent, panels.bodyFor(agent.kind), bodySlot, context);
    const mounted = [body];

    const controls = panels.panelsFor(agent.kind, 'controls');
    if (controls.length > 0) {
      const column = element('div', 'agent-tab-controls stack');
      for (const panel of controls) {
        const slot = element('div', 'agent-tab-control');
        column.append(slot);
        mounted.push(mountPanel(agent, panel, slot, context));
      }
      root.classList.add('with-controls');
      root.append(column);
    }

    /** One slot around the body, there only when a panel of this kind fills it. */
    function around(slot: Exclude<PanelSlot, 'body' | 'controls' | 'header'>): HTMLElement[] {
      const slotPanels = panels.panelsFor(agent.kind, slot);
      if (slotPanels.length === 0) return [];
      const holder = element('div', `agent-tab-${slot} stack`);
      for (const panel of slotPanels) {
        const part = element('div', 'agent-tab-part');
        holder.append(part);
        mounted.push(mountPanel(agent, panel, part, context));
      }
      return [holder];
    }
    root.append(...around('above'), bodySlot, ...around('aside'));

    const header = shell.agentTabHeader(agent.id);
    const headerSlots = header
      ? panels.panelsFor(agent.kind, 'header').map((panel) => {
          const slot = element('span', 'tab-panel');
          header.append(slot);
          mounted.push(mountPanel(agent, panel, slot, context));
          return slot;
        })
      : [];

    return { root, mounted, headerSlots };
  }

  function close(agentId: AgentId, session: Session): void {
    const notes = session.mounted
      .map((panel) => safely(agentId, 'say why it ended', () => panel.endNote?.()))
      .filter((note): note is string => typeof note === 'string' && note !== '');
    session.mounted.forEach((panel) => safely(agentId, 'close', () => panel.dispose?.()));
    session.headerSlots.forEach((slot) => slot.remove());
    // An agent that stops while its tab is open leaves the message, never an empty screen.
    if (session.root.isConnected) session.root.replaceWith(notRunning(notes));
    else session.root.remove();
    sessions.delete(agentId);
  }

  function shown(agentId: AgentId, session: Session): void {
    session.mounted.forEach((panel) => safely(agentId, 'show', () => panel.shown?.()));
  }

  const stopFollowing = shell.onAgentTabs((list: readonly unknown[]) => {
    const agents = list.filter(isAgentInfo);
    const running = new Set(agents.map(({ id }) => id));
    for (const [id, session] of sessions) {
      if (!running.has(id)) close(id, session);
    }
    for (const agent of agents) {
      if (sessions.has(agent.id)) continue;
      const session = open(agent);
      sessions.set(agent.id, session);
      const placeholder = awaited.get(agent.id);
      if (placeholder) {
        awaited.delete(agent.id);
        placeholder.replaceWith(session.root);
        shown(agent.id, session);
      }
    }
  });

  return {
    show(el, agentId) {
      const session = sessions.get(agentId);
      if (!session) {
        const placeholder = notRunning();
        el.append(placeholder);
        awaited.set(agentId, placeholder);
        return () => {
          if (awaited.get(agentId) === placeholder) awaited.delete(agentId);
          placeholder.remove();
          sessions.get(agentId)?.root.remove();
        };
      }
      el.append(session.root);
      shown(agentId, session);
      return () => session.root.remove();
    },
    dispose() {
      stopFollowing();
      for (const [id, session] of sessions) close(id, session);
    },
  };
}
