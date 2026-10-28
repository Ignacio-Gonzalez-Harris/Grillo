// The own-time panel on the agent tab, found by the agent tab's panel discovery (`@screens/*/tab-panel.ts`).
import { ownTimePanel } from './agent-panel';
import { ownTimeAgents } from './agents';

export default ownTimePanel({ agents: ownTimeAgents });
