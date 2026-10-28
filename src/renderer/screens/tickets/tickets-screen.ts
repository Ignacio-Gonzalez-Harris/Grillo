/**
 * Ticket-and-question management (PRD sections 4.3 items 2-5, 4.4 items 1 and 5; section 5 screen 4; prototype
 * `screen-ticket-management`): the member's own list first (taken by or sent to them, their domains, everything else),
 * then per ticket its questions with their answered state and source, tags changed by hand, Take, Send, Reassign and
 * Release under the store's claim rule, Edit, Merge, Close as out of scope, Undo on a recorded answer, and Answer now.
 * "Pick up GitHub comments" starts the agent that turns members' GitHub comments into answers.
 *
 * A merge or close from here involves no agent, so a `mapDone` result starts the PRD writer (the map-done rule). The
 * screen reads the store afresh whenever an agent goes quiet, since agents answer, tag and close tickets as they work.
 */
import './tickets.css';
import type { Store } from '../../../main/store/store';
import type { Discussion, Member, ProjectId, Ticket, TicketKind } from '../../../main/store/types';
import type { AgentId, AgentInfo } from '../../../shared/agents';
import type { GrilloApi, Unsubscribe } from '../../../shared/ipc';
import { AGENT_SCREEN } from '../../app/navigation';
import type { ScreenParams } from '../../app/screens';
import { badge, button, dialog } from '../../theme/components';
import {
  closeAsOutOfScope,
  declaredDomains,
  editTicket,
  mergeTicket,
  projectFolder,
  projectFrom,
  type CloseOutcome,
} from '../map/map-data';
import { choice, codeChip, domainTags, el, kindBadge, kindChoice, messageOf, note, textArea, textField, type Content } from '../map/view';
import { OWN_TIME_SCREEN } from '../own-time/agent-panel';
import type { QuestionView } from '../own-time/ticket';
import { startCommentPickup, startPrdWriter } from './agents';
import {
  answerLine,
  firstTicket,
  groupTickets,
  isMine,
  lockedByOther,
  NO_DOMAIN,
  readTicketDetail,
  sameLogin,
  readTicketsView,
  tagChoices,
  withoutTag,
  withTag,
  type TicketDetail,
  type TicketsView,
} from './tickets-data';

/** The PRD view's screen id (its tab in the project tab bar). */
export const PRD_SCREEN = 'prd';

export interface TicketsDeps {
  store: Store;
  grillo: GrilloApi;
  navigate(screenId: string, params?: ScreenParams): void;
  onAgentTabs(listener: (agents: readonly AgentInfo[]) => void): Unsubscribe;
}

const NO_PROJECT = 'Open a project from the Project tab to see its tickets.';
const NO_TICKETS = 'No tickets yet. They appear here once the grilling agent has built the map.';
const NO_MATCH = 'No ticket matches your search.';
const ARCHIVED = 'The repository is archived: everything stays readable and nothing can change.';
const REASSIGN_HINT = 'Any member can reassign a ticket nobody has answered yet.';
const PICKUP_STARTED = 'The comment pickup runs in its own tab. The answers appear here when it finishes.';
const MAP_DONE = 'The map is done: no open tickets and no fog.';
const WRITING_PRD = 'Grillo is writing the PRD now.';

type Phase =
  | { name: 'loading' }
  | { name: 'failed'; message: string }
  | { name: 'ready'; project: ProjectId; view: TicketsView };

/** A dialog that stays in place across redraws, so what the member typed survives a busy state. */
interface Editor {
  el: HTMLElement;
  /** Every control of the dialog, disabled while an action runs. */
  controls: Array<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
}

/** "3 comments written in GitHub wait…", or "1 comment written in GitHub waits…". */
function pickupWaiting(count: number): string {
  return count === 1
    ? '1 comment written in GitHub waits to be recorded as an answer.'
    : `${count} comments written in GitHub wait to be recorded as answers.`;
}

/** A labelled list of `[value, label]` options with a first placeholder option that picks nothing. */
function picker(label: string, placeholder: string, options: ReadonlyArray<readonly [string, string]>): HTMLSelectElement {
  const select = el('select', 'w-auto', [placeholder, ...options.map(([, text]) => text)].map((text) => el('option', '', [text])));
  [...select.options].forEach((option, index) => (option.value = index === 0 ? '' : options[index - 1][0]));
  select.setAttribute('aria-label', label);
  return select;
}

export function mountTickets(container: HTMLElement, params: ScreenParams, deps: TicketsDeps): () => void {
  const { store, grillo, navigate } = deps;
  const root = el('div', 'tickets-screen');
  container.replaceChildren(root);

  let disposed = false;
  let phase: Phase = { name: 'loading' };
  let busy = false;
  let actionError: string | null = null;
  let search = '';
  let selected: number | null = /^[1-9][0-9]*$/.test(params['ticket'] ?? '') ? Number(params['ticket']) : null;
  let detail: TicketDetail | null = null;
  let detailError: string | null = null;
  let showDiscussion = false;
  let editor: Editor | null = null;
  let pickupAgent: AgentId | null = null;
  let prdWriter: AgentId | null = null;
  let prdError: string | null = null;
  /** Bumped on every detail read, so a slower earlier read never overwrites a later one. */
  let detailRead = 0;

  function set(next: Phase): void {
    if (disposed) return;
    phase = next;
    draw();
  }

  function currentTicket(view: TicketsView): Ticket | undefined {
    return view.tickets.find((ticket) => ticket.id.number === selected);
  }

  /** Keeps the open ticket when it is still in the list, else opens the list's first. */
  function pickSelected(view: TicketsView): Ticket | undefined {
    const kept = currentTicket(view);
    if (kept) return kept;
    const first = firstTicket(groupTickets(view.tickets, view.member));
    selected = first?.id.number ?? null;
    return first;
  }

  async function loadDetail(ticket: Ticket | undefined): Promise<void> {
    const read = ++detailRead;
    if (!ticket) {
      detail = null;
      return;
    }
    try {
      const next = await readTicketDetail(store, ticket.id);
      if (read !== detailRead) return;
      detail = next;
      detailError = null;
    } catch (error) {
      if (read !== detailRead) return;
      detail = null;
      detailError = messageOf(error);
    }
  }

  async function reload(project: ProjectId): Promise<void> {
    const view = await readTicketsView(store, project);
    await loadDetail(pickSelected(view));
    set({ name: 'ready', project, view });
  }

  /** Runs one write; a refusal shows its message and the screen reads the store again, so a lock taken elsewhere shows. */
  async function act(work: (project: ProjectId) => Promise<void>): Promise<void> {
    if (busy || phase.name !== 'ready') return;
    const { project } = phase;
    busy = true;
    actionError = null;
    draw();
    try {
      await work(project);
    } catch (error) {
      actionError = messageOf(error);
      try {
        await reload(project);
      } catch {
        // The refusal above is what the member needs to see; the list stays as it was.
      }
    } finally {
      busy = false;
      if (!disposed) draw();
    }
  }

  /** A write on one ticket, then a fresh read. */
  function write(work: () => Promise<unknown>): Promise<void> {
    return act(async (project) => {
      await work();
      editor = null;
      await reload(project);
    });
  }

  /** A merge or close from this screen: the map-done rule's screen path starts the PRD writer. */
  async function afterClose(project: ProjectId, outcome: CloseOutcome): Promise<void> {
    editor = null;
    if (outcome.mapDone) {
      try {
        prdWriter = await startPrdWriter(grillo, await projectFolder(store, project));
        prdError = null;
      } catch (error) {
        prdError = messageOf(error);
      }
    }
    await reload(project);
  }

  function select(ticket: Ticket): void {
    if (ticket.id.number === selected) return;
    selected = ticket.id.number;
    detail = null;
    detailError = null;
    showDiscussion = false;
    editor = null;
    draw();
    void loadDetail(ticket).then(() => {
      if (!disposed) draw();
    });
  }

  function openEditor(build: () => Editor): void {
    actionError = null;
    editor = build();
    draw();
  }

  function closeEditor(): void {
    editor = null;
    draw();
  }

  function editorActions(confirmLabel: string, onConfirm: () => void, danger = false): HTMLButtonElement[] {
    return [
      button('Cancel', { small: true, onClick: closeEditor }),
      button(confirmLabel, { small: true, variant: danger ? 'danger' : 'primary', onClick: onConfirm }),
    ];
  }

  function editEditor(ticket: Ticket): Editor {
    const title = textField('Title', ticket.title);
    const kind = kindChoice(ticket.kind);
    const question = textArea('Question', ticket.question);
    const why = textArea('Why it matters', ticket.whyItMatters);
    const actions = editorActions('Save', () =>
      void write(() =>
        editTicket(store, ticket.id, {
          title: title.input.value,
          kind: kind.input.value as TicketKind,
          question: question.input.value,
          whyItMatters: why.input.value,
        }),
      ),
    );
    return {
      el: dialog({ title: `Edit ${ticket.title}`, body: [title.root, kind.root, question.root, why.root], actions }),
      controls: [title.input, kind.input, question.input, why.input, ...actions],
    };
  }

  function mergeEditor(ticket: Ticket, view: TicketsView): Editor {
    const others = view.tickets.filter((other) => other.state === 'open' && other.id.number !== ticket.id.number);
    const into = choice(
      'Merge into',
      others.map((other) => [String(other.id.number), other.title] as const),
    );
    const actions = editorActions('Merge', () =>
      void act(async (project) => afterClose(project, await mergeTicket(store, ticket.id, Number(into.input.value)))),
    );
    const body: Content[] =
      others.length === 0
        ? [el('p', 'reason', ['There is no other open ticket to merge it into.'])]
        : [el('p', 'small muted', [`${ticket.title} closes as a duplicate of the ticket you pick.`]), into.root];
    // Nothing to merge into: Merge stays off whatever the busy state.
    if (others.length === 0) actions[1].dataset['off'] = 'true';
    return {
      el: dialog({ title: `Merge ${ticket.title}`, body, actions }),
      controls: [into.input, ...actions],
    };
  }

  function outOfScopeEditor(ticket: Ticket): Editor {
    const why = textField('Why it is out of scope (optional)');
    const actions = editorActions(
      'Close as out of scope',
      () => void act(async (project) => afterClose(project, await closeAsOutOfScope(store, ticket, why.input.value))),
      true,
    );
    const hint = el('p', 'small muted', [`${ticket.title} closes with no decision and a line under Out of scope.`]);
    return {
      el: dialog({ title: `Close ${ticket.title} as out of scope`, body: [hint, why.root], actions }),
      controls: [why.input, ...actions],
    };
  }

  function pickUpComments(): Promise<void> {
    return act(async (project) => {
      pickupAgent = await startCommentPickup(grillo, await projectFolder(store, project));
    });
  }

  // ---------- The list ----------

  function listRow(ticket: Ticket, view: TicketsView, declared: string[]): HTMLElement {
    const label: Content[] = [ticket.title];
    if (ticket.state === 'open' && lockedByOther(ticket, view.member)) label.push(el('span', 'muted', [` · ${ticket.assignee}`]));
    const pick = el('button', 'pick', label);
    pick.type = 'button';
    pick.addEventListener('click', () => select(ticket));
    const row = el('li', ticket.id.number === selected ? 'selected' : '', [pick, el('span', 'row', domainTags(ticket, declared))]);
    if (ticket.id.number === selected) pick.setAttribute('aria-current', 'true');
    return row;
  }

  function listCard(view: TicketsView, declared: string[]): HTMLElement {
    const field = el('input', '');
    field.type = 'search';
    field.placeholder = 'Search tickets';
    field.value = search;
    field.setAttribute('aria-label', 'Search tickets');
    field.addEventListener('input', () => {
      search = field.value;
      draw();
      const again = root.querySelector<HTMLInputElement>('input[type="search"]');
      again?.focus();
      again?.setSelectionRange(search.length, search.length);
    });
    const groups = groupTickets(view.tickets, view.member, search);
    const parts: HTMLElement[] = [field];
    const sections: Array<[string, Ticket[]]> = [
      ['Taken by you or sent to you', groups.mine],
      ['Your domains', groups.domains],
      ['Everything else', groups.others],
      ['Closed', groups.closed],
    ];
    for (const [heading, tickets] of sections) {
      if (tickets.length === 0) continue;
      parts.push(
        el('p', 'list-head', [heading]),
        el(
          'ul',
          'rows small ticket-list',
          tickets.map((ticket) => listRow(ticket, view, declared)),
        ),
      );
    }
    if (parts.length === 1) parts.push(el('p', 'small muted', [NO_MATCH]));
    return el('div', 'card', parts);
  }

  // ---------- The open ticket ----------

  function statusBadge(ticket: Ticket, view: TicketsView, questions: QuestionView[] | null): HTMLElement {
    if (ticket.state === 'closed') {
      const into = view.tickets.find(({ id }) => id.number === ticket.duplicateOf);
      if (ticket.duplicateOf !== null) return badge(`Closed · merged into ${into?.title ?? `ticket ${ticket.duplicateOf}`}`, 'ok');
      if (questions !== null && questions.length > 0 && questions.every((question) => question.answered)) {
        return badge('Closed · all questions answered', 'ok');
      }
      return badge('Closed', 'ok');
    }
    if (ticket.assignee === null) return badge('Not assigned');
    if (isMine(ticket, view.member)) return badge('Assigned to you', 'info');
    return badge(`Locked · assigned to ${ticket.assignee}`, 'warn');
  }

  function tagsRow(ticket: Ticket, declared: string[], canChange: boolean): HTMLElement {
    const tags = domainTags(ticket, declared);
    if (canChange && (ticket.noDomain || ticket.domains.length > 0)) {
      const names = ticket.noDomain ? [NO_DOMAIN] : ticket.domains;
      tags.forEach((tag, index) => {
        const remove = el('button', '', ['×']);
        remove.type = 'button';
        remove.disabled = busy;
        remove.setAttribute('aria-label', `Remove ${names[index]}`);
        remove.addEventListener('click', () => void write(() => store.updateTicket(ticket.id, withoutTag(ticket, names[index]))));
        tag.append(remove);
      });
    }
    const parts: Content[] = [el('span', 'small strong muted', ['Domains']), ...tags];
    const choices = tagChoices(ticket, declared);
    if (canChange && choices.length > 0) {
      const add = picker('Add a domain tag', 'Add a domain…', choices.map((domain) => [domain, domain] as const));
      add.disabled = busy;
      add.addEventListener('change', () => {
        const tag = add.value;
        if (tag !== '') void write(() => store.updateTicket(ticket.id, withTag(ticket, tag)));
      });
      parts.push(add);
    }
    return el('div', 'row', parts);
  }

  /** A member picker and its button, the button off until a member is picked. */
  function memberAction(
    label: string,
    placeholder: string,
    members: readonly Member[],
    me: Member,
    run: (login: string) => Promise<unknown>,
  ): HTMLElement[] {
    const options = members.map((member) => [member.login, sameLogin(member.login, me.login) ? `${member.login} (you)` : member.login] as const);
    const pick = picker(`${label} to`, placeholder, options);
    pick.disabled = busy;
    const go = button(label, { disabled: true, onClick: () => void write(() => run(pick.value)) });
    pick.addEventListener('change', () => (go.disabled = busy || pick.value === ''));
    return [pick, go];
  }

  function manageActions(ticket: Ticket, view: TicketsView): HTMLElement[] {
    return [
      button('Edit', { small: true, disabled: busy, onClick: () => openEditor(() => editEditor(ticket)) }),
      button('Merge', { small: true, disabled: busy, onClick: () => openEditor(() => mergeEditor(ticket, view)) }),
      button('Close as out of scope', { small: true, disabled: busy, onClick: () => openEditor(() => outOfScopeEditor(ticket)) }),
    ];
  }

  function claimRows(ticket: Ticket, view: TicketsView, answered: boolean): HTMLElement[] {
    const { member, project } = view;
    const others = project.members.filter((candidate) => !sameLogin(candidate.login, member.login));
    if (ticket.assignee === null) {
      const take = button('Take', { variant: 'primary', disabled: busy, onClick: () => void write(() => store.claimTicket(ticket.id)) });
      const send = memberAction('Send', 'Send to…', others, member, (login) => store.sendTicket(ticket.id, login));
      return [el('div', 'row', [take, ...send, el('span', 'spacer'), ...manageActions(ticket, view)])];
    }

    const rows: HTMLElement[] = [];
    if (isMine(ticket, member)) {
      const release = button('Release', { disabled: busy, onClick: () => void write(() => store.releaseTicket(ticket.id)) });
      rows.push(
        el('div', 'row', [release, el('span', 'small muted', ['Back to the pool, unlocked.']), el('span', 'spacer'), ...manageActions(ticket, view)]),
      );
    } else {
      rows.push(
        el('div', 'row', [
          button('Take', { disabled: true }),
          el('span', 'reason', [`Assigned to ${ticket.assignee}. You can still read and discuss it.`]),
        ]),
      );
    }
    if (answered) {
      rows.push(el('p', 'small muted', ['It has an answer already, so it can no longer be reassigned.']));
    } else {
      const holder = ticket.assignee;
      const targets = project.members.filter((candidate) => !sameLogin(holder, candidate.login));
      const reassign = memberAction('Reassign', 'Reassign to…', targets, member, (login) => store.reassignTicket(ticket.id, login));
      rows.push(el('div', 'row', [...reassign, el('span', 'small muted', [REASSIGN_HINT])]));
    }
    return rows;
  }

  function answerDetails(ticket: Ticket, question: QuestionView, view: TicketsView, canChange: boolean): { info: HTMLElement; undo: HTMLElement | null } {
    const answer = question.answer;
    if (answer === null) return { info: el('p', 'small muted', ['Answered; the answer could not be read.']), undo: null };
    const line = answerLine(answer, view.sources);
    const parts: Content[] = [`Answer: ${line.text} `];
    if (line.viaGithub) {
      parts.push('Source: ', el('strong', '', [line.origin ?? '']), ` · recorded by ${line.recordedBy}`);
    } else {
      parts.push(`Recorded by ${line.recordedBy}, ${line.day}`);
      if (line.sources.length > 0) parts.push(' · source');
    }
    for (const code of line.sources) parts.push(' ', codeChip(code));
    const undo = canChange
      ? button('Undo', { small: true, disabled: busy, onClick: () => void write(() => store.deleteAnswer(ticket.id, answer.id)) })
      : null;
    return { info: el('p', 'small muted', parts), undo };
  }

  function questionRows(ticket: Ticket, view: TicketsView, questions: QuestionView[], canChange: boolean): HTMLElement {
    if (questions.length === 0) return el('p', 'small muted', ['This ticket has no questions.']);
    return el(
      'ul',
      'rows',
      questions.map((question) => {
        if (!question.answered) return el('li', '', [el('span', 'grow', [`${question.code}: ${question.text}`]), badge('Open')]);
        const { info, undo } = answerDetails(ticket, question, view, canChange);
        const state = el('span', 'row', [badge('Answered', 'ok')]);
        if (undo) state.append(undo);
        return el('li', '', [el('div', 'grow', [`${question.code}: ${question.text}`, info]), state]);
      }),
    );
  }

  function discussionPanel(discussions: Discussion[]): HTMLElement {
    if (discussions.length === 0) return el('p', 'small muted', ['No discussion recorded for this ticket yet.']);
    return el(
      'div',
      'stack',
      discussions.map((discussion) =>
        el('div', 'stack', [
          el('p', 'small strong m0', [`${discussion.question} · recorded by ${discussion.who}, ${discussion.when.slice(0, 10)}`]),
          el(
            'div',
            'transcript',
            discussion.transcript.replace(/\r\n?/g, '\n').split('\n').map((line) => el('p', '', [line])),
          ),
        ]),
      ),
    );
  }

  function githubNote(questions: QuestionView[]): HTMLElement | null {
    const recorders = new Set<string>();
    for (const question of questions) {
      if (question.answer?.via === 'github' && typeof question.answer.who === 'string') recorders.add(question.answer.who);
    }
    if (recorders.size === 0) return null;
    return el('p', 'small muted', [`Recorded from GitHub comments by ${[...recorders].join(', ')}. Any member can undo it.`]);
  }

  function ticketCard(ticket: Ticket, view: TicketsView, declared: string[], project: ProjectId): HTMLElement {
    const ready = detail !== null && detail.ticket.number === ticket.id.number ? detail : null;
    const questions = ready?.questions ?? null;
    const archived = view.project.archived;
    const open = ticket.state === 'open';
    const parts: HTMLElement[] = [
      el('div', 'row', [el('h3', 'm0', [ticket.title]), kindBadge(ticket.kind), statusBadge(ticket, view, questions)]),
      tagsRow(ticket, declared, open && !archived),
    ];
    if (open && !archived) parts.push(...claimRows(ticket, view, questions?.some((question) => question.answered) ?? false));
    if (editor) {
      editor.controls.forEach((control) => (control.disabled = busy || control.dataset['off'] === 'true'));
      parts.push(editor.el);
    }
    parts.push(el('h4', '', ['Questions']));
    if (questions === null) {
      parts.push(detailError === null ? el('p', 'small muted', ['Loading the questions…']) : note(detailError, 'err'));
      return el('div', 'card stack', parts);
    }
    parts.push(questionRows(ticket, view, questions, !archived));
    const fromGithub = githubNote(questions);
    if (fromGithub) parts.push(fromGithub);
    const toggle = button(showDiscussion ? 'Hide discussion' : 'Show discussion (word for word)', {
      onClick: () => {
        showDiscussion = !showDiscussion;
        draw();
      },
    });
    const footer: Content[] = [toggle, el('span', 'spacer')];
    if (open && !archived) {
      footer.push(
        button('Answer now', {
          variant: 'primary',
          onClick: () => navigate(OWN_TIME_SCREEN, { project, ticket: String(ticket.id.number) }),
        }),
      );
    }
    parts.push(el('div', 'row', footer));
    if (showDiscussion && ready) parts.push(discussionPanel(ready.discussions));
    return el('div', 'card stack', parts);
  }

  // ---------- Notes above the list ----------

  function pickupNote(view: TicketsView): HTMLElement | null {
    if (pickupAgent !== null) {
      const agentId = pickupAgent;
      const openAgent = button('Open the comment pickup', { small: true, onClick: () => navigate(AGENT_SCREEN, { agentId }) });
      return note([el('div', 'row', [el('span', 'fill', [PICKUP_STARTED]), openAgent])]);
    }
    if (view.pickupComments === 0 || view.project.archived) return null;
    const pick = button('Pick up GitHub comments', { variant: 'primary', small: true, disabled: busy, onClick: () => void pickUpComments() });
    return note([el('div', 'row', [el('span', 'fill', [pickupWaiting(view.pickupComments)]), pick])]);
  }

  function doneNote(project: ProjectId): HTMLElement {
    const parts: Content[] = [el('span', 'fill', [prdWriter === null ? MAP_DONE : `${MAP_DONE} ${WRITING_PRD}`])];
    if (prdWriter !== null) {
      const agentId = prdWriter;
      parts.push(button('Open the PRD writer', { small: true, onClick: () => navigate(AGENT_SCREEN, { agentId }) }));
    }
    parts.push(button('Open the PRD', { small: true, onClick: () => navigate(PRD_SCREEN, { project }) }));
    return note([el('div', 'row', parts)], 'ok');
  }

  function drawReady(project: ProjectId, view: TicketsView): HTMLElement[] {
    const parts: HTMLElement[] = [];
    if (view.project.archived) parts.push(note(ARCHIVED, 'warn'));
    if (prdWriter !== null) parts.push(doneNote(project));
    if (prdError !== null) parts.push(note(`The map is done, but Grillo could not start the PRD writer: ${prdError}`, 'err'));
    if (actionError !== null) parts.push(note(actionError, 'err'));
    const pickup = pickupNote(view);
    if (pickup) parts.push(pickup);
    if (view.tickets.length === 0) {
      parts.push(el('div', 'card', [el('p', 'muted', [NO_TICKETS])]));
      return parts;
    }
    const declared = declaredDomains(view);
    const ticket = currentTicket(view);
    const side: HTMLElement = ticket
      ? ticketCard(ticket, view, declared, project)
      : el('div', 'card', [el('p', 'muted', ['Pick a ticket from the list.'])]);
    parts.push(el('div', 'split', [listCard(view, declared), side]));
    return parts;
  }

  function draw(): void {
    if (disposed) return;
    switch (phase.name) {
      case 'loading':
        root.replaceChildren(el('p', 'muted', ['Loading the tickets…']));
        return;
      case 'failed':
        root.replaceChildren(note(phase.message, 'err'));
        return;
      case 'ready':
        root.replaceChildren(...drawReady(phase.project, phase.view));
    }
  }

  /** Reads the store again without leaving the screen; a failure shows above the list it had. */
  async function refresh(): Promise<void> {
    if (phase.name !== 'ready' || busy) return;
    const { project } = phase;
    try {
      await reload(project);
    } catch (error) {
      actionError = messageOf(error);
      draw();
    }
  }

  let waiting = new Map<AgentId, boolean>();
  const stopTabs = deps.onAgentTabs((list) => {
    const now = new Map(list.map((agent) => [agent.id, agent.waiting === true]));
    // An agent that went quiet after working, or that stopped, may have answered, tagged or closed tickets.
    const quieted =
      [...now].some(([id, isWaiting]) => isWaiting && waiting.get(id) === false) || [...waiting.keys()].some((id) => !now.has(id));
    waiting = now;
    if (quieted) void refresh();
  });

  async function load(): Promise<void> {
    try {
      const project = await projectFrom(store, params);
      if (project === null) set({ name: 'failed', message: NO_PROJECT });
      else await reload(project);
    } catch (error) {
      set({ name: 'failed', message: messageOf(error) });
    }
  }

  draw();
  void load();

  return () => {
    disposed = true;
    stopTabs();
  };
}
