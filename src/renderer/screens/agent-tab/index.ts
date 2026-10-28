// The agent tab, found by the shell's screen discovery (`@screens/*/index.ts`): every agent's own tab, opened with
// `{ agentId }`. Its panels come from `src/renderer/screens/*/tab-panel.ts`; the terminal is the default body.
import type { ScreenParams, ShellContext } from '../../app/screens';
import { createAgentTabs, type AgentTabs } from './agent-tabs';
import { loadTabPanels } from './tab-panels';
import { terminalPanel } from './terminal-panel';

export const id = 'agent-tab';
export const title = 'Agent';

let agentTabs: AgentTabs | undefined;

/** Runs once when the shell starts: from then on every agent tab gets its panels as soon as it appears. */
export function start(shell: ShellContext): () => void {
  const tabs = createAgentTabs(shell, loadTabPanels([terminalPanel()]));
  agentTabs = tabs;
  return () => {
    tabs.dispose();
    if (agentTabs === tabs) agentTabs = undefined;
  };
}

export function mount(el: HTMLElement, params: ScreenParams): () => void {
  if (!agentTabs) {
    throw new Error('The agent tab was opened before the shell started it');
  }
  return agentTabs.show(el, params['agentId'] ?? '');
}
