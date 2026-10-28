/**
 * The own-time screen's agents: the grilling agent that answers one ticket (`/grillo-answer <ticket number>`), the
 * PRD writer a `mapDone` result starts (`/grillo-prd`), and the protocol messages typed into a running agent
 * (`resources/skills/README.md`, Screen-to-agent protocol).
 */
import { agentTitle, type AgentId } from '../../../shared/agents';
import type { GrilloApi, Unsubscribe } from '../../../shared/ipc';
import type { TicketId } from '../../../main/store/types';

export const ANSWER_COMMAND = '/grillo-answer';
export const PRD_COMMAND = '/grillo-prd';
/** The control lines this screen types (`resources/skills/README.md`, The messages). */
export const DONE_LINE = 'done';
export const USE_IT_LINE = 'use it';
/** What the member sees once Done has been typed into the agent answering the ticket. */
export const DONE_SENT = 'Done sent. The agent closes the ticket, or returns it to the pool with its open questions, then stops.';
/** The PRD writer's tab name. */
export const PRD_WRITER_TITLE = agentTitle('grilling', 'PRD');

/**
 * Which running agents answer which ticket. The agent tab's own-time panel shows itself only on these agents. A
 * tab can appear before `agents:start` answers, so the panel listens for the agent to be remembered.
 */
export interface OwnTimeAgents {
  remember(agentId: AgentId, ticket: TicketId): void;
  forget(agentId: AgentId): void;
  ticketOf(agentId: AgentId): TicketId | undefined;
  /** The remembered agent answering this ticket, if one is among `running`. */
  agentFor(ticket: TicketId, running: readonly AgentId[]): AgentId | undefined;
  onChange(listener: () => void): Unsubscribe;
}

export function createOwnTimeAgents(): OwnTimeAgents {
  const tickets = new Map<AgentId, TicketId>();
  const listeners = new Set<() => void>();
  const tell = () => [...listeners].forEach((listener) => listener());
  return {
    remember(agentId, ticket) {
      tickets.set(agentId, { project: ticket.project, number: ticket.number });
      tell();
    },
    forget(agentId) {
      if (tickets.delete(agentId)) tell();
    },
    ticketOf: (agentId) => tickets.get(agentId),
    agentFor: (ticket, running) =>
      running.find((id) => {
        const answering = tickets.get(id);
        return answering?.project === ticket.project && answering.number === ticket.number;
      }),
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The one list the app's own-time screen and the agent tab's panel share. */
export const ownTimeAgents = createOwnTimeAgents();

/** Starts the grilling agent that answers the ticket in the member's own time, and remembers it. */
export async function startAnsweringAgent(
  grillo: GrilloApi,
  agents: OwnTimeAgents,
  folder: string,
  ticket: { id: TicketId; title: string },
): Promise<AgentId> {
  const agentId = await grillo.invoke('agents:start', {
    kind: 'grilling',
    folder,
    firstMessage: `${ANSWER_COMMAND} ${ticket.id.number}`,
    title: agentTitle('grilling', ticket.title),
  });
  agents.remember(agentId, ticket.id);
  return agentId;
}

/** Starts the PRD writer, as a `mapDone` result from a screen requires (the map-done rule). */
export function startPrdWriter(grillo: GrilloApi, folder: string): Promise<AgentId> {
  return grillo.invoke('agents:start', { kind: 'grilling', folder, firstMessage: PRD_COMMAND, title: PRD_WRITER_TITLE });
}

/**
 * A pasted or uploaded transcript as one `use it` message: the transcript's lines, then the control line on a line
 * of its own. Sent as one write, the line breaks inside it do not send; Enter follows as its own write.
 */
export function useItMessage(transcript: string): string {
  const chunk = transcript.replace(/\r\n?/g, '\n').trimEnd();
  return chunk.trim() === '' ? USE_IT_LINE : `${chunk}\n${USE_IT_LINE}`;
}

const ENTER = '\r';

/**
 * Types a message into the agent, then presses Enter as a write of its own, as the type box does (Claude Code reads
 * text and Enter in one write as a paste). Unlike the type box it lets a failure through, so the screen can show it.
 */
async function typeMessage(grillo: GrilloApi, agentId: AgentId, text: string): Promise<void> {
  await grillo.invoke('agents:write', { id: agentId, text });
  await grillo.invoke('agents:write', { id: agentId, text: ENTER });
}

export function sendUseIt(grillo: GrilloApi, agentId: AgentId, transcript: string): Promise<void> {
  return typeMessage(grillo, agentId, useItMessage(transcript));
}

export function sendDone(grillo: GrilloApi, agentId: AgentId): Promise<void> {
  return typeMessage(grillo, agentId, DONE_LINE);
}
