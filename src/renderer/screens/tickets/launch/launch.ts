/**
 * The launch control of ticket management (release 3; prototype `screen-ticket-management`, state `launch`): a
 * research, prototype or task ticket gets "Launch <kind> agent", which opens an agent tab of that kind running the
 * catalogue command `/grillo-<kind> <ticket number>` (resources/skills/README.md, Commands). A grilling ticket, or a
 * kind Grillo does not know, gets no control. A ticket already held by a member (the agent claims it as its runner)
 * or whose agent tab still runs cannot be launched again.
 */
import { agentTitle, type AgentId, type AgentInfo, type AgentKind } from '../../../../shared/agents';
import type { GrilloApi } from '../../../../shared/ipc';
import type { Member, Ticket } from '../../../../main/store/types';
import { button } from '../../../theme/components';
import { el } from '../../map/view';
import { isMine } from '../tickets-data';

export interface Launch {
  /** The agent kind, the same word as the ticket kind. */
  kind: AgentKind;
  /** The button's text: "Launch research agent". */
  label: string;
  /** The kind as the tab names it: "Research". */
  tabKind: string;
  /** What the agent records as the ticket's answer, as the catalogue says it. */
  records: 'finding' | 'outcome';
  /** The first message typed into the agent: `/grillo-research 12`. */
  command(ticket: number): string;
  /** The tab's name: "Research · Sample ticket 12". */
  title(ticketTitle: string): string;
}

function kindLaunch(kind: 'research' | 'prototype' | 'task', tabKind: string, records: Launch['records']): Launch {
  return {
    kind,
    label: `Launch ${kind} agent`,
    tabKind,
    records,
    command: (ticket) => `/grillo-${kind} ${ticket}`,
    title: (ticketTitle) => agentTitle(kind, ticketTitle),
  };
}

/** The ticket kinds that get a launch control; a Map, so no inherited name (`constructor`) ever matches. */
const LAUNCHES: ReadonlyMap<string, Launch> = new Map([
  ['research', kindLaunch('research', 'Research', 'finding')],
  ['prototype', kindLaunch('prototype', 'Prototype', 'outcome')],
  ['task', kindLaunch('task', 'Task', 'outcome')],
]);

/** The launch a ticket kind gets, or null for a grilling ticket and any kind Grillo does not know. */
export function launchFor(kind: string): Launch | null {
  return LAUNCHES.get(kind) ?? null;
}

const HELD = 'A ticket already held by an agent or a member cannot be launched again.';

export type LaunchState =
  | { name: 'none' }
  | { name: 'ready'; launch: Launch }
  | { name: 'held'; launch: Launch; reason: string };

/** Whether an open ticket shows a launch control, and whether it may launch now given the running agent tabs. */
export function launchState(ticket: Ticket, member: Member, agents: readonly AgentInfo[]): LaunchState {
  const launch = launchFor(ticket.kind);
  if (launch === null || ticket.state !== 'open') return { name: 'none' };
  const tab = launch.title(ticket.title);
  if (agents.some((agent) => agent.kind === launch.kind && agent.title === tab)) {
    return { name: 'held', launch, reason: `Running in the ${tab} tab.` };
  }
  if (ticket.assignee !== null) {
    const holder = isMine(ticket, member) ? 'you' : ticket.assignee;
    return { name: 'held', launch, reason: `Assigned to ${holder}. ${HELD}` };
  }
  return { name: 'ready', launch };
}

/** Starts the ticket's agent in the project folder, typing its catalogue command as the first message. */
export function startKindAgent(grillo: GrilloApi, folder: string, ticket: Ticket, launch: Launch): Promise<AgentId> {
  return grillo.invoke('agents:start', {
    kind: launch.kind,
    folder,
    firstMessage: launch.command(ticket.id.number),
    title: launch.title(ticket.title),
  });
}

export interface LaunchControl {
  /** The button, first in the ticket's action row; null when the ticket gets no control. */
  button: HTMLButtonElement | null;
  /** The line under the action row: what the launch does, or why it cannot launch. */
  hint: HTMLElement | null;
}

/** The launch button and its line for one open ticket. */
export function launchControl(state: LaunchState, ticket: Ticket, options: { busy: boolean; onLaunch(launch: Launch): void }): LaunchControl {
  if (state.name === 'none') return { button: null, hint: null };
  const { launch } = state;
  if (state.name === 'held') {
    return { button: button(launch.label, { disabled: true }), hint: el('p', 'reason', [state.reason]) };
  }
  const hint = el('p', 'small muted', [
    `Opens a ${launch.tabKind} tab that runs `,
    el('code', '', [launch.command(ticket.id.number)]),
    `. The agent assigns the ticket to itself, works it as wayfinder does and records its ${launch.records} as an answer with its sources.`,
  ]);
  return {
    button: button(launch.label, { variant: 'primary', disabled: options.busy, onClick: () => options.onLaunch(launch) }),
    hint,
  };
}
