import type { AgentId, AgentInfo } from '../../shared/agents';
import { APP_TABS, GENERIC_AGENT_SCREEN, PROJECT_TABS, type FixedTab } from './navigation';

/** Which tab the member is on: a fixed tab's screen, an agent's tab, or "+". */
export type ActiveTab = { screenId: string } | { agentId: AgentId };

export interface TabBarHandlers {
  openScreen(screenId: string): void;
  openAgent(agentId: AgentId): void;
  openGenericAgent(): void;
}

export interface TabBar {
  el: HTMLElement;
  setAgents(agents: readonly AgentInfo[]): void;
  setActive(active: ActiveTab): void;
  agentTabHeader(agentId: AgentId): HTMLElement | undefined;
}

interface AgentTab {
  root: HTMLElement;
  name: HTMLButtonElement;
  dot: HTMLElement;
  header: HTMLElement;
}

function separator(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'tab-sep';
  return el;
}

function markActive(el: HTMLElement, active: boolean): void {
  el.classList.toggle('active', active);
  if (active) el.setAttribute('aria-current', 'page');
  else el.removeAttribute('aria-current');
}

/**
 * The project tab bar of the prototype: Setup and Project, then Map, Tickets and PRD, then one tab per running agent
 * (its name, the waiting dot and an empty header slot), then "+". Agent tabs are kept across updates, so whatever a
 * later story mounts in a tab's header stays there while the agent runs.
 */
export function createTabBar(handlers: TabBarHandlers): TabBar {
  const el = document.createElement('nav');
  el.className = 'tabbar';
  el.setAttribute('aria-label', 'Navigation');

  const fixedTabs = new Map<string, HTMLButtonElement>();
  function fixedTab({ screenId, label }: FixedTab): HTMLButtonElement {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.textContent = label;
    tab.addEventListener('click', () => handlers.openScreen(screenId));
    fixedTabs.set(screenId, tab);
    return tab;
  }

  const agentStrip = document.createElement('span');
  agentStrip.className = 'agent-tabs';

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tab add';
  add.textContent = '+';
  add.setAttribute('aria-label', 'Open a generic agent');
  add.addEventListener('click', () => handlers.openGenericAgent());

  el.append(...APP_TABS.map(fixedTab), separator(), ...PROJECT_TABS.map(fixedTab), separator(), agentStrip, add);

  const agentTabs = new Map<AgentId, AgentTab>();
  let active: ActiveTab | undefined;

  function createAgentTab(id: AgentId): AgentTab {
    const root = document.createElement('div');
    root.className = 'tab';
    root.dataset['agentId'] = id;
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'tab-name';
    name.addEventListener('click', () => handlers.openAgent(id));
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.title = 'Waiting for you';
    const header = document.createElement('span');
    header.className = 'tab-header';
    root.append(name, dot, header);
    return { root, name, dot, header };
  }

  function refreshActive(): void {
    for (const [screenId, tab] of fixedTabs) {
      markActive(tab, active !== undefined && 'screenId' in active && active.screenId === screenId);
    }
    for (const [id, tab] of agentTabs) {
      markActive(tab.root, active !== undefined && 'agentId' in active && active.agentId === id);
    }
    const generic = active !== undefined && 'screenId' in active && active.screenId === GENERIC_AGENT_SCREEN;
    add.setAttribute('aria-pressed', String(generic));
  }

  return {
    el,
    setAgents(agents) {
      const running = new Set(agents.map((agent) => agent.id));
      for (const [id, tab] of agentTabs) {
        if (!running.has(id)) {
          tab.root.remove();
          agentTabs.delete(id);
        }
      }
      for (const agent of agents) {
        const tab = agentTabs.get(agent.id) ?? createAgentTab(agent.id);
        agentTabs.set(agent.id, tab);
        tab.name.textContent = agent.title;
        tab.dot.hidden = !agent.waiting;
        agentStrip.append(tab.root);
      }
      refreshActive();
    },
    setActive(next) {
      active = next;
      refreshActive();
    },
    agentTabHeader(agentId) {
      return agentTabs.get(agentId)?.header;
    },
  };
}
