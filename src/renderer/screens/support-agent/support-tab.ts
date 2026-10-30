/**
 * The Support tab on the tab bar (prototype `screen-support-agent-tab`; PRD section 4.6 item 7): always there from
 * release 2, as the first agent tab. Until the support agent runs it is this screen's own tab, which starts the agent;
 * once the agent runs, the agent's own tab (its name, waiting dot and Open channel switch) takes its place and is kept
 * at the front of the agent tabs.
 *
 * The shell offers no way to add a tab, so this reaches into the tab bar the shell drew: the agent tab strip
 * (`AGENT_STRIP`) and the class names the shell's tab styles use. The tests run against the real shell, so a change to
 * that markup fails them.
 */
import type { AgentInfo } from '../../../shared/agents';
import type { ShellContext } from '../../app/screens';
import { el } from '../own-time/view';

/** The tab bar's strip of agent tabs, drawn by the shell. */
const AGENT_STRIP = 'nav.tabbar .agent-tabs';
/** The label of the Support tab before its agent runs; the agent's tab then shows its own name. */
const SUPPORT_LABEL = 'Support';

export interface SupportTab {
  /** Marks this screen's tab as the open one, as the shell marks its own tabs. */
  setActive(active: boolean): void;
  /** Takes the tab off the tab bar and stops following the agent tabs. */
  dispose(): void;
}

function markActive(tab: HTMLElement, active: boolean): void {
  tab.classList.toggle('active', active);
  if (active) tab.setAttribute('aria-current', 'page');
  else tab.removeAttribute('aria-current');
}

/** Puts the Support tab first among the agent tabs; `open` runs when the member presses it. */
export function createSupportTab(shell: ShellContext, open: () => void): SupportTab {
  const strip = document.querySelector<HTMLElement>(AGENT_STRIP);
  if (!strip) {
    console.warn('The tab bar has no agent tab strip; the Support tab is not shown.');
    return { setActive: () => undefined, dispose: () => undefined };
  }

  const name = el('button', 'tab-name', [SUPPORT_LABEL]);
  name.type = 'button';
  name.addEventListener('click', open);
  const ownTab = el('div', 'tab support-tab', [name]);

  const place = (agents: readonly AgentInfo[]): void => {
    const support = agents.find((agent) => agent.kind === 'support');
    const agentTab = support && shell.agentTabHeader(support.id)?.closest<HTMLElement>('.tab');
    if (agentTab) ownTab.remove();
    const first = agentTab ?? ownTab;
    // Only when out of place: moving a tab takes keyboard focus off it.
    if (strip.firstElementChild !== first) strip.prepend(first);
  };

  const stopFollowing = shell.onAgentTabs(place);

  return {
    setActive: (active) => markActive(ownTab, active),
    dispose() {
      stopFollowing();
      ownTab.remove();
    },
  };
}
