// The own-time panels on the agent tab, found by the agent tab's panel discovery (`@screens/*/tab-panel.ts`).
import { ownTimePanels } from './agent-panel';
import { ownTimeAgents } from './agents';

export default ownTimePanels({ agents: ownTimeAgents });
