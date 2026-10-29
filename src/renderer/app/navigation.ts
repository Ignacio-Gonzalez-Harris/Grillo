/**
 * The shell's fixed navigation (PRD section 5; prototype `docs/ux/prototypes/grillo/index.html`). Each tab opens the
 * screen registered under its id, which is the screen's folder name under `src/renderer/screens/`.
 */

export interface FixedTab {
  screenId: string;
  label: string;
}

/** Outside a project: the setup check and the project screen. */
export const APP_TABS: readonly FixedTab[] = [
  { screenId: 'setup-check', label: 'Setup' },
  { screenId: 'project-creation', label: 'Project' },
];

/** Inside a project, as the prototype's tab bar shows them, before the agent tabs. */
export const PROJECT_TABS: readonly FixedTab[] = [
  { screenId: 'map', label: 'Map' },
  { screenId: 'tickets', label: 'Tickets' },
  { screenId: 'prd', label: 'PRD' },
];

/** The setup check, which shows the update offer itself (PRD section 4.1 item 4). */
export const SETUP_CHECK_SCREEN = 'setup-check';

/** The screen the shell opens first. */
export const START_SCREEN = SETUP_CHECK_SCREEN;

/** The screen an agent's tab opens, with `{ agentId }`. */
export const AGENT_SCREEN = 'agent-tab';

/** The screen "+" opens. */
export const GENERIC_AGENT_SCREEN = 'generic-agent';

/** What the shell calls a screen it opens before the screen's own story has registered it. */
export const UNBUILT_SCREEN_NAMES: ReadonlyMap<string, string> = new Map([
  ...[...APP_TABS, ...PROJECT_TABS].map((tab): [string, string] => [tab.screenId, tab.label]),
  [AGENT_SCREEN, 'The agent tab'],
  [GENERIC_AGENT_SCREEN, 'The generic agent tab'],
]);
