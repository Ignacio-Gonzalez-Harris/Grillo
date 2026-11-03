/**
 * The shell's fixed navigation (PRD section 5; prototype `docs/ux/prototypes/grillo/index.html`). Each tab opens the
 * screen registered under its id, which is the screen's folder name under `src/renderer/screens/`.
 */

export interface FixedTab {
  screenId: string;
  label: string;
}

/** The setup check, which shows the update offer itself (PRD section 4.1 item 4). */
export const SETUP_CHECK_SCREEN = 'setup-check';

/** The project screen, where a start with setup done opens and where the setup check's Continue goes. */
export const PROJECT_SCREEN = 'project-creation';

/** The first tab on the left of the tab bar. */
export const PROJECT_TAB: FixedTab = { screenId: PROJECT_SCREEN, label: 'Project' };

/** The last tab on the right of the tab bar, in reach however many agent tabs are open. */
export const SETUP_TAB: FixedTab = { screenId: SETUP_CHECK_SCREEN, label: 'Setup' };

/** Outside a project: the project screen and the setup check. */
export const APP_TABS: readonly FixedTab[] = [PROJECT_TAB, SETUP_TAB];

/** Inside a project, as the prototype's tab bar shows them, before the agent tabs. */
export const PROJECT_TABS: readonly FixedTab[] = [
  { screenId: 'map', label: 'Map' },
  { screenId: 'tickets', label: 'Tickets' },
  { screenId: 'prd', label: 'PRD' },
];

/** A project as screens are opened with it: `{ project: '<owner>/<repo>' }`. */
export const PROJECT_ID = /^[^/\s]+\/[^/\s]+$/;

/** The screen the shell opens first on a first launch, and on any start whose checks do not all pass. */
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
