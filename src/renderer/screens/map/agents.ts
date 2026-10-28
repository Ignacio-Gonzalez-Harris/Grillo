/**
 * The map screen's agents (resources/skills/README.md, Commands): the tagging round (`/grillo-tagging`), and the PRD
 * writer a `mapDone` result starts (`/grillo-prd`, the map-done rule), shared with the own-time screen.
 */
import { agentTitle, type AgentId } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';

export { PRD_COMMAND, PRD_WRITER_TITLE, startPrdWriter } from '../own-time/agents';

export const TAGGING_COMMAND = '/grillo-tagging';
/** The tagging round's tab name. */
export const TAGGING_TITLE = agentTitle('grilling', 'Tagging round');

/** Starts a grilling agent in the project folder that runs the tagging round. */
export function startTaggingRound(grillo: GrilloApi, folder: string): Promise<AgentId> {
  return grillo.invoke('agents:start', { kind: 'grilling', folder, firstMessage: TAGGING_COMMAND, title: TAGGING_TITLE });
}
