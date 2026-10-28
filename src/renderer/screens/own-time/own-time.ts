/**
 * Own-time answering (PRD section 4.4, section 5 screen 6; prototype `screen-own-time-answering`): the member answers
 * a ticket in a form, or starts a grilling agent for it, and presses Done. Opened with
 * `{ project: '<owner>/<repo>', ticket: '<issue number>' }`.
 *
 * In the form no agent is involved, so Done closes or releases the ticket itself and acts on `mapDone`. With a
 * grilling agent the agent tab hosts the agent, and its own-time panel (agent-panel.ts) only types `done`.
 */
import './own-time.css';
import type { Store } from '../../../main/store/store';
import type { TicketId } from '../../../main/store/types';
import type { AgentId } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import { AGENT_SCREEN } from '../../app/navigation';
import type { ScreenParams } from '../../app/screens';
import { badge, button } from '../../theme/components';
import { startAnsweringAgent, startPrdWriter, type OwnTimeAgents } from './agents';
import {
  finishTicket,
  projectFolder,
  readTicketView,
  saveAnswer,
  takeTicket,
  ticketIdFrom,
  type DoneResult,
  type QuestionView,
  type TicketView,
} from './ticket';
import { answeredBadge, closedOutcome, el, headingRow, messageOf, note, releasedOutcome, type AnswerWith } from './view';

export interface OwnTimeDeps {
  store: Store;
  grillo: GrilloApi;
  agents: OwnTimeAgents;
  navigate(screenId: string, params?: ScreenParams): void;
  now?: () => Date;
}

const NO_TICKET = 'Open a ticket from the Tickets tab to answer it here.';
const DONE_HINT = 'Done with open questions returns the ticket to the pool, unlocked.';

type Phase =
  | { name: 'loading' }
  | { name: 'failed'; message: string }
  | { name: 'unavailable'; message: string }
  | { name: 'form'; view: TicketView }
  | { name: 'done'; result: DoneResult; prdWriter: AgentId | null; prdError: string | null };

/** Why a ticket cannot be answered here, or null when the member can answer it. */
function unavailableReason(view: TicketView): string | null {
  const { ticket, member } = view;
  if (ticket.state === 'closed') return `${ticket.title} is closed: there is nothing left to answer.`;
  const holder = ticket.assignee;
  if (holder !== null && holder.toLowerCase() !== member.login.toLowerCase()) {
    return `${ticket.title} is taken by ${holder}. Only they can answer it now; you can still read it on the Tickets tab.`;
  }
  return null;
}

async function runningAgents(grillo: GrilloApi): Promise<AgentId[]> {
  const list: unknown = await grillo.invoke('agents:list', undefined);
  if (!Array.isArray(list)) return [];
  return list.map((agent) => (agent as { id?: unknown } | null)?.id).filter((id): id is AgentId => typeof id === 'string');
}

export function mountOwnTime(container: HTMLElement, params: ScreenParams, deps: OwnTimeDeps): () => void {
  const { store, grillo, agents, navigate } = deps;
  const root = el('div', 'own-time');
  container.replaceChildren(root);

  let disposed = false;
  let phase: Phase = { name: 'loading' };
  let busy = false;
  let actionError: string | null = null;
  /** What the member has typed per question and not yet saved; it survives every redraw. */
  const drafts = new Map<string, string>();
  /** Answered questions the member is changing. */
  const editing = new Set<string>();

  function set(next: Phase): void {
    if (disposed) return;
    phase = next;
    draw();
  }

  async function act(work: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    actionError = null;
    draw();
    try {
      await work();
    } catch (error) {
      actionError = messageOf(error);
    } finally {
      busy = false;
      if (!disposed) draw();
    }
  }

  function questionCard(view: TicketView, question: QuestionView): HTMLElement {
    const head = el('div', 'row', [el('span', 'strong fill', [`${question.code} ${question.text}`]), answeredBadge(question)]);
    const card = el('div', 'card stack', [head]);
    if (question.answered && !editing.has(question.code)) {
      if (question.answer) card.append(el('p', 'small', [question.answer.text]));
      const edit = button('Edit', {
        small: true,
        disabled: busy,
        onClick: () => {
          editing.add(question.code);
          if (!drafts.has(question.code)) drafts.set(question.code, question.answer?.text ?? '');
          draw();
        },
      });
      card.append(el('div', 'row', [edit]));
      return card;
    }

    const field = el('textarea', '');
    field.setAttribute('aria-label', `Answer to ${question.code}`);
    field.placeholder = 'Your answer';
    field.value = drafts.get(question.code) ?? '';
    field.disabled = busy;
    const save = button('Save answer', {
      small: true,
      disabled: busy,
      onClick: () =>
        void act(async () => {
          await saveAnswer(store, view, question.code, field.value, { now: deps.now });
          drafts.delete(question.code);
          editing.delete(question.code);
          set({ name: 'form', view: await readTicketView(store, view.ticket.id) });
        }),
    });
    const markTyped = () => save.classList.toggle('primary', field.value.trim() !== '');
    markTyped();
    field.addEventListener('input', () => {
      drafts.set(question.code, field.value);
      markTyped();
    });
    const actions = el('div', 'row', [save]);
    if (editing.has(question.code)) {
      actions.append(
        button('Cancel', {
          small: true,
          disabled: busy,
          onClick: () => {
            editing.delete(question.code);
            drafts.delete(question.code);
            draw();
          },
        }),
      );
    }
    card.append(field, actions);
    return card;
  }

  function answerWithAgent(view: TicketView): Promise<void> {
    return act(async () => {
      const id = view.ticket.id;
      let agentId = agents.agentFor(id, await runningAgents(grillo));
      if (agentId === undefined) {
        agentId = await startAnsweringAgent(grillo, agents, await projectFolder(store, id.project), view.ticket);
      }
      if (!disposed) navigate(AGENT_SCREEN, { agentId });
    });
  }

  function done(id: TicketId): Promise<void> {
    return act(async () => {
      const result = await finishTicket(store, id);
      let prdWriter: AgentId | null = null;
      let prdError: string | null = null;
      if (result.outcome === 'closed' && result.mapDone) {
        try {
          prdWriter = await startPrdWriter(grillo, await projectFolder(store, id.project));
        } catch (error) {
          prdError = messageOf(error);
        }
      }
      set({ name: 'done', result, prdWriter, prdError });
    });
  }

  function drawForm(view: TicketView): HTMLElement[] {
    const choose = (choice: AnswerWith) => {
      if (choice === 'agent') void answerWithAgent(view);
    };
    const doneButton = button('Done', { variant: 'primary', disabled: busy, onClick: () => void done(view.ticket.id) });
    return [
      headingRow(view, 'form', choose),
      ...(actionError ? [note(actionError, 'err')] : []),
      ...view.questions.map((question) => questionCard(view, question)),
      el('div', 'row', [el('span', 'spacer'), el('span', 'small muted', [DONE_HINT]), doneButton]),
    ];
  }

  function drawDone(result: DoneResult, prdWriter: AgentId | null, prdError: string | null): HTMLElement[] {
    if (result.outcome === 'released') return releasedOutcome(result.view);
    const parts: HTMLElement[] = [closedOutcome(result.view, result.decisionOnMap)];
    if (prdWriter !== null) {
      const open = button('Open the PRD writer', { small: true, onClick: () => navigate(AGENT_SCREEN, { agentId: prdWriter }) });
      parts.push(el('div', 'row', [badge('Map done', 'info'), el('span', 'small', ['A grilling agent is writing the next PRD version.']), el('span', 'spacer'), open]));
    }
    if (prdError !== null) parts.push(note(`The map is done, but Grillo could not start the PRD writer: ${prdError}`, 'err'));
    return parts;
  }

  function draw(): void {
    switch (phase.name) {
      case 'loading':
        root.replaceChildren(el('p', 'muted', ['Loading the ticket…']));
        return;
      case 'failed':
        root.replaceChildren(note(phase.message, 'err'));
        return;
      case 'unavailable':
        root.replaceChildren(note(phase.message, 'warn'));
        return;
      case 'form':
        root.replaceChildren(...drawForm(phase.view));
        return;
      case 'done':
        root.replaceChildren(...drawDone(phase.result, phase.prdWriter, phase.prdError));
    }
  }

  async function load(id: TicketId): Promise<void> {
    try {
      const view = await readTicketView(store, id);
      const reason = unavailableReason(view);
      set(reason === null ? { name: 'form', view: await takeTicket(store, view) } : { name: 'unavailable', message: reason });
    } catch (error) {
      set({ name: 'failed', message: messageOf(error) });
    }
  }

  draw();
  const id = ticketIdFrom(params);
  if (id === null) set({ name: 'failed', message: NO_TICKET });
  else void load(id);

  return () => {
    disposed = true;
  };
}
