/**
 * The PRD view's agents (resources/skills/README.md, Commands): Regenerate starts the PRD writer with
 * `/grillo-prd regenerate`, and "Talk to an agent about this PRD" starts a grilling agent with `/grillo-prd feedback`.
 *
 * The writer runs under the same tab name whoever starts it (this screen, or a screen acting on `mapDone`), so the
 * screen tells a PRD being written from the agent list alone: a writer of this project's folder that is still
 * working, not yet waiting for the member.
 */
import { agentTitle, type AgentId, type AgentInfo } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import { PRD_COMMAND, PRD_WRITER_TITLE } from '../own-time/agents';

export const REGENERATE_COMMAND = `${PRD_COMMAND} regenerate`;
export const FEEDBACK_COMMAND = `${PRD_COMMAND} feedback`;
export { PRD_WRITER_TITLE };
/** The feedback agent's tab name. */
export const PRD_FEEDBACK_TITLE = agentTitle('grilling', 'PRD feedback');

/** Starts the PRD writer on a new version from everything, in the current structure (PRD section 4.7 item 3). */
export function startRegenerate(grillo: GrilloApi, folder: string): Promise<AgentId> {
  return grillo.invoke('agents:start', { kind: 'grilling', folder, firstMessage: REGENERATE_COMMAND, title: PRD_WRITER_TITLE });
}

/** Starts the grilling agent the member tells what is wrong with the PRD (PRD section 4.7 item 6). */
export function startFeedback(grillo: GrilloApi, folder: string): Promise<AgentId> {
  return grillo.invoke('agents:start', { kind: 'grilling', folder, firstMessage: FEEDBACK_COMMAND, title: PRD_FEEDBACK_TITLE });
}

/** The project's PRD writers that are still working: running in its folder, and not waiting for the member. */
export function workingWriters(agents: readonly AgentInfo[], folder: string): AgentInfo[] {
  return agents.filter((agent) => agent.title === PRD_WRITER_TITLE && agent.folder === folder && !agent.waiting);
}
