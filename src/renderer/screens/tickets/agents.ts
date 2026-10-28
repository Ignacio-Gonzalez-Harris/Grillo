/**
 * The tickets screen's agents (resources/skills/README.md, Commands): the comment pickup (`/grillo-answer pickup`),
 * and the PRD writer a `mapDone` result starts (`/grillo-prd`, the map-done rule), shared with the own-time screen.
 */
import { agentTitle, type AgentId } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';

export { PRD_COMMAND, PRD_WRITER_TITLE, startPrdWriter } from '../own-time/agents';

export const PICKUP_COMMAND = '/grillo-answer pickup';
/** The comment pickup's tab name. */
export const PICKUP_TITLE = agentTitle('grilling', 'GitHub comments');

/** Starts a grilling agent in the project folder that turns members' GitHub comments into recorded answers. */
export function startCommentPickup(grillo: GrilloApi, folder: string): Promise<AgentId> {
  return grillo.invoke('agents:start', { kind: 'grilling', folder, firstMessage: PICKUP_COMMAND, title: PICKUP_TITLE });
}
