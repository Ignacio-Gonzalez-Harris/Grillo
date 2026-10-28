/**
 * The live session's meeting agents: grilling agents started with `/grillo-meeting` (`resources/skills/README.md`,
 * Commands), each remembered with its project, so the meeting panel shows itself on their tabs and on no other.
 */
import { agentTitle, type AgentId } from '../../../shared/agents';
import type { GrilloApi, Unsubscribe } from '../../../shared/ipc';

export const MEETING_COMMAND = '/grillo-meeting';
/** A meeting agent's tab name until it renames itself after the ticket at hand. */
export const MEETING_AGENT_TITLE = agentTitle('grilling', 'Live session');

export interface MeetingAgents {
  remember(agentId: AgentId, project: string): void;
  forget(agentId: AgentId): void;
  /** The project this meeting agent works for; undefined for any other agent. */
  projectOf(agentId: AgentId): string | undefined;
  /** How many meeting agents are remembered: the session ends with the last of them. */
  count(): number;
  onChange(listener: () => void): Unsubscribe;
}

export function createMeetingAgents(): MeetingAgents {
  const projects = new Map<AgentId, string>();
  const listeners = new Set<() => void>();
  const tell = () => [...listeners].forEach((listener) => listener());
  return {
    remember(agentId, project) {
      projects.set(agentId, project);
      tell();
    },
    forget(agentId) {
      if (projects.delete(agentId)) tell();
    },
    projectOf: (agentId) => projects.get(agentId),
    count: () => projects.size,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The one list the meeting panel and whatever starts a meeting agent share. */
export const meetingAgents = createMeetingAgents();

/**
 * Starts a meeting agent in the project folder and remembers it: its tab shows the meeting panel, which starts the
 * live session if none is running and types the presence and mode messages once the agent is ready.
 */
export async function startMeetingAgent(
  grillo: GrilloApi,
  agents: MeetingAgents,
  request: { project: string; folder: string },
): Promise<AgentId> {
  const agentId = await grillo.invoke('agents:start', {
    kind: 'grilling',
    folder: request.folder,
    firstMessage: MEETING_COMMAND,
    title: MEETING_AGENT_TITLE,
  });
  agents.remember(agentId, request.project);
  return agentId;
}
