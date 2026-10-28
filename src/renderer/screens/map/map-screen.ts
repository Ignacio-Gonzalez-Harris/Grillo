/**
 * The map and its tickets (PRD sections 4.2 item 7, 4.3, 4.8; section 5 screen 3; prototype `screen-map-and-tickets`):
 * destination, settled, fog and out of scope; the ticket list with kinds, domain tags, assignees and blockers, its
 * ticket actions and the tagging round; the Sources list with each source's full text; closing and reopening the
 * project. Opened with `{ project: '<owner>/<repo>' }`, or with nothing for the project opened last on this laptop.
 *
 * A close or merge from here involves no agent, so a `mapDone` result starts the PRD writer (the map-done rule). The
 * screen reads the store afresh whenever an agent goes quiet, since agents change the map and tickets as they work.
 */
import './map.css';
import type { Store } from '../../../main/store/store';
import type { ProjectId, Source, Ticket, TicketKind } from '../../../main/store/types';
import type { AgentId, AgentInfo } from '../../../shared/agents';
import type { GrilloApi, Unsubscribe } from '../../../shared/ipc';
import { AGENT_SCREEN } from '../../app/navigation';
import type { ScreenParams } from '../../app/screens';
import { badge, button, dialog } from '../../theme/components';
import { startPrdWriter, startTaggingRound } from './agents';
import {
  addTicket,
  closeAsOutOfScope,
  declaredDomains,
  editTicket,
  engineBuilding,
  inMyDomains,
  isTagged,
  mapIsDone,
  mergeTicket,
  projectFolder,
  projectFrom,
  readMapView,
  type CloseOutcome,
  type MapView,
} from './map-data';
import {
  choice,
  codeChip,
  dayOf,
  domainTags,
  el,
  kindBadge,
  kindChoice,
  mapCard,
  messageOf,
  note,
  sourceKindLabel,
  sourcePanel,
  table,
  textArea,
  textField,
  type Content,
} from './view';

/** The PRD view's screen id (its tab in the project tab bar). */
export const PRD_SCREEN = 'prd';

export interface MapDeps {
  store: Store;
  grillo: GrilloApi;
  navigate(screenId: string, params?: ScreenParams): void;
  onAgentTabs(listener: (agents: readonly AgentInfo[]) => void): Unsubscribe;
}

const NO_PROJECT = 'Open a project from the Project tab to see its map.';
const BUILDING = 'The grilling agent is building the map and tickets from your idea. Tickets appear here as they are created.';
const ARCHIVED = 'The repository is archived: everything stays readable and nothing can change.';
const ARCHIVED_REASON = 'Archived: reopen the project to change anything.';
const CLOSE_HINT = 'Closing archives the repository: everything stays readable and nothing can change. A repository admin can reopen it.';
const MAP_DONE = 'The map is done: no open tickets and no fog.';
const WRITING_PRD = 'Grillo is writing the PRD now.';
const TAGGING_STARTED = 'The tagging round runs in its own tab. The tags appear here when it finishes.';
const RERUN_HINT = 'Rerun the tagging round when members join.';

type Phase =
  | { name: 'loading' }
  | { name: 'failed'; message: string }
  | { name: 'ready'; project: ProjectId; view: MapView };

type Order = 'mine' | 'all';

/** A dialog that stays in place across redraws, so what the member typed survives a busy state. */
interface Editor {
  el: HTMLElement;
  /** Every control of the dialog, disabled while an action runs. */
  controls: Array<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
}

/** "All 5 tickets are closed.", or "The only ticket is closed." */
function allClosed(count: number): string {
  return count === 1 ? 'The only ticket is closed.' : `All ${count} tickets are closed.`;
}

function adminReason(permission: string, action: string): string {
  return `Only a repository admin can ${action}; you have ${permission} access.`;
}

export function mountMap(container: HTMLElement, params: ScreenParams, deps: MapDeps): () => void {
  const { store, grillo, navigate } = deps;
  const root = el('div', 'map-screen');
  container.replaceChildren(root);

  let disposed = false;
  let phase: Phase = { name: 'loading' };
  let busy = false;
  let actionError: string | null = null;
  let order: Order = 'mine';
  let editor: Editor | null = null;
  let openSource: Source | null = null;
  let taggingAgent: AgentId | null = null;
  let prdWriter: AgentId | null = null;
  let prdError: string | null = null;

  function set(next: Phase): void {
    if (disposed) return;
    phase = next;
    draw();
  }

  async function reload(project: ProjectId): Promise<void> {
    set({ name: 'ready', project, view: await readMapView(store, project) });
  }

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
    } finally {
      busy = false;
      if (!disposed) draw();
    }
  }

  /** A close or merge from this screen: the map-done rule's screen path starts the PRD writer. */
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

  function addEditor(): Editor {
    const title = textField('Title');
    const kind = kindChoice('grilling');
    const question = textArea('Question');
    const why = textArea('Why it matters');
    const questions = textArea('Questions, one per line (none: the question above is the only one)');
    const actions = editorActions('Add ticket', () =>
      void act(async (project) => {
        await addTicket(store, project, {
          title: title.input.value,
          kind: kind.input.value as TicketKind,
          question: question.input.value,
          whyItMatters: why.input.value,
          questions: questions.input.value,
        });
        editor = null;
        await reload(project);
      }),
    );
    return {
      el: dialog({ title: 'Add ticket', body: [title.root, kind.root, question.root, why.root, questions.root], actions }),
      controls: [title.input, kind.input, question.input, why.input, questions.input, ...actions],
    };
  }

  function editEditor(ticket: Ticket): Editor {
    const title = textField('Title', ticket.title);
    const kind = kindChoice(ticket.kind);
    const question = textArea('Question', ticket.question);
    const why = textArea('Why it matters', ticket.whyItMatters);
    const actions = editorActions('Save', () =>
      void act(async (project) => {
        await editTicket(store, ticket.id, {
          title: title.input.value,
          kind: kind.input.value as TicketKind,
          question: question.input.value,
          whyItMatters: why.input.value,
        });
        editor = null;
        await reload(project);
      }),
    );
    return {
      el: dialog({ title: `Edit ${ticket.title}`, body: [title.root, kind.root, question.root, why.root], actions }),
      controls: [title.input, kind.input, question.input, why.input, ...actions],
    };
  }

  function mergeEditor(ticket: Ticket, view: MapView): Editor {
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

  function runTaggingRound(): Promise<void> {
    return act(async (project) => {
      taggingAgent = await startTaggingRound(grillo, await projectFolder(store, project));
    });
  }

  function setArchived(archived: boolean): Promise<void> {
    return act(async (project) => {
      await (archived ? store.archiveProject(project) : store.unarchiveProject(project));
      await reload(project);
    });
  }

  function mapCards(view: MapView): HTMLElement {
    const { map } = view;
    const titles = new Map(view.tickets.map((ticket) => [ticket.id.number, ticket.title]));
    const done = mapIsDone(view);
    return el('div', 'grid-2', [
      mapCard('Destination', map?.destination ?? 'Not written yet.', ''),
      mapCard(
        'Settled',
        (map?.settled ?? []).map(({ ticket, gist }) => `${titles.get(ticket) ?? `Ticket ${ticket}`}: ${gist}`),
        'Nothing settled yet.',
      ),
      mapCard('Fog', map?.fog ?? [], done ? 'No fog left.' : 'Nothing yet.'),
      mapCard('Out of scope', map?.outOfScope ?? [], 'Nothing yet.'),
    ]);
  }

  function orderSwitch(): HTMLElement {
    const group = el('div', 'seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Filter');
    const choices: Array<[Order, string]> = [
      ['all', 'All'],
      ['mine', 'My domains first'],
    ];
    for (const [value, label] of choices) {
      const option = el('button', '', [label]);
      option.type = 'button';
      option.setAttribute('aria-pressed', String(value === order));
      option.addEventListener('click', () => {
        order = value;
        draw();
      });
      group.append(option);
    }
    return group;
  }

  function ordered(view: MapView, open: Ticket[]): Ticket[] {
    if (order === 'all') return open;
    const first = open.filter((ticket) => inMyDomains(ticket, view.member));
    return [...first, ...open.filter((ticket) => !first.includes(ticket))];
  }

  function ticketActions(ticket: Ticket, view: MapView): Content {
    if (view.project.archived) return '';
    const edit = button('Edit', { small: true, disabled: busy, onClick: () => openEditor(() => editEditor(ticket)) });
    // A locked ticket (taken or sent) keeps only Edit, as the prototype's rows show.
    if (ticket.assignee !== null) return edit;
    return el('span', 'row', [
      edit,
      button('Merge', { small: true, disabled: busy, onClick: () => openEditor(() => mergeEditor(ticket, view)) }),
      button('Close as out of scope', { small: true, disabled: busy, onClick: () => openEditor(() => outOfScopeEditor(ticket)) }),
    ]);
  }

  function ticketRow(ticket: Ticket, view: MapView, declared: string[]): Content[] {
    const titles = new Map(view.tickets.map((other) => [other.id.number, other.title]));
    const domains = el('span', 'row', domainTags(ticket, declared));
    const assignee: Content = ticket.assignee === null ? '—' : el('span', 'row', [ticket.assignee, badge('Locked', 'warn')]);
    const blockers = ticket.blockers.map((number) => titles.get(number) ?? `Ticket ${number}`).join(', ') || '—';
    return [ticket.title, kindBadge(ticket.kind), domains, assignee, blockers, ticketActions(ticket, view)];
  }

  function ticketsCard(view: MapView): HTMLElement {
    const open = view.tickets.filter((ticket) => ticket.state === 'open');
    if (engineBuilding(view)) {
      const rows = el(
        'ul',
        'rows',
        open.map((ticket) => el('li', '', [el('span', '', [ticket.title]), kindBadge(ticket.kind)])),
      );
      return el('div', 'card stack', [el('h3', '', ['Tickets']), el('p', 'note small', [BUILDING]), rows]);
    }

    const { archived } = view.project;
    const tagged = open.some(isTagged);
    const declared = declaredDomains(view);
    const head = el('div', 'row', [el('h3', 'm0', ['Tickets']), el('span', 'spacer')]);
    if (tagged && open.length > 0) head.append(orderSwitch());
    head.append(button('Add ticket', { disabled: busy || archived, onClick: () => openEditor(addEditor) }));
    // With every ticket closed there is nothing to tag; an archived project shows the control greyed out instead.
    if (open.length > 0 || archived) {
      head.append(
        button('Run tagging round', {
          variant: tagged || archived ? undefined : 'primary',
          disabled: busy || archived,
          onClick: () => void runTaggingRound(),
        }),
      );
    }
    const parts: HTMLElement[] = [head];
    if (archived) parts.push(el('p', 'reason', [ARCHIVED_REASON]));
    if (editor) {
      editor.controls.forEach((control) => (control.disabled = busy || control.dataset['off'] === 'true'));
      parts.push(editor.el);
    }
    if (taggingAgent !== null) {
      const agentId = taggingAgent;
      const openAgent = button('Open the tagging round', { small: true, onClick: () => navigate(AGENT_SCREEN, { agentId }) });
      parts.push(note([el('div', 'row', [el('span', 'fill', [TAGGING_STARTED]), openAgent])]));
    }
    if (open.length === 0) {
      parts.push(el('p', 'small muted', [allClosed(view.tickets.length)]));
      return el('div', 'card stack', parts);
    }
    const hint = tagged
      ? RERUN_HINT
      : declared.length === 0
        ? 'An agent gives every open ticket one or more domains from the members’ domains. Nobody has declared a domain yet, so every ticket gets “no domain”.'
        : `An agent gives every open ticket one or more domains from the members’ domains: ${declared.join(', ')}.`;
    parts.push(
      el('p', 'small muted', [hint]),
      table(
        ['Ticket', 'Kind', 'Domains', 'Assignee', 'Blocked by', ''],
        ordered(view, open).map((ticket) => ticketRow(ticket, view, declared)),
        'tickets',
      ),
    );
    return el('div', 'card stack', parts);
  }

  function sourcesCard(view: MapView): HTMLElement {
    const parts: HTMLElement[] = [
      el('h3', '', ['Sources']),
      el('p', 'small muted', ['Every source a decision came from, with its stable code. The PRD cites these codes.']),
    ];
    if (view.sources.length === 0) {
      parts.push(el('p', 'small muted', ['No sources yet.']));
    } else {
      parts.push(
        table(
          ['Code', 'Kind', 'Who', 'When', 'Where', ''],
          view.sources.map((source) => [
            codeChip(source.code),
            sourceKindLabel(source.kind),
            source.who,
            dayOf(source.when),
            source.where,
            button('Open', {
              small: true,
              onClick: () => {
                openSource = source;
                draw();
              },
            }),
          ]),
          'sources',
        ),
      );
    }
    return el('div', 'card stack', parts);
  }

  function projectCard(view: MapView): HTMLElement {
    const admin = view.permission === 'admin';
    const close = button('Close project', { variant: 'danger', disabled: busy || !admin, onClick: () => void setArchived(true) });
    const why = admin ? el('span', 'small muted', [CLOSE_HINT]) : el('span', 'reason', [adminReason(view.permission, 'close the project')]);
    return el('div', 'card stack', [el('h3', '', ['Project']), el('div', 'row', [close, why])]);
  }

  function archivedNote(view: MapView): HTMLElement {
    const admin = view.permission === 'admin';
    const reopen = button('Reopen', { variant: 'primary', disabled: busy || !admin, onClick: () => void setArchived(false) });
    const parts: Content[] = [el('span', 'fill', [ARCHIVED]), reopen];
    if (!admin) parts.push(el('span', 'reason full', [adminReason(view.permission, 'reopen it')]));
    return note([el('div', 'row', parts)], 'warn');
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

  function drawReady(project: ProjectId, view: MapView): HTMLElement[] {
    if (openSource !== null) {
      const close = button('Close', {
        small: true,
        onClick: () => {
          openSource = null;
          draw();
        },
      });
      return [sourcePanel(openSource, close)];
    }
    const building = engineBuilding(view);
    const parts: HTMLElement[] = [];
    if (view.project.archived) parts.push(archivedNote(view));
    // An archived project says it is archived; whether its map was done is no longer news.
    if (!building && !view.project.archived && (mapIsDone(view) || prdWriter !== null)) parts.push(doneNote(project));
    if (prdError !== null) parts.push(note(`The map is done, but Grillo could not start the PRD writer: ${prdError}`, 'err'));
    if (actionError !== null) parts.push(note(actionError, 'err'));
    parts.push(mapCards(view), ticketsCard(view));
    if (!building) parts.push(sourcesCard(view));
    if (!building && !view.project.archived) parts.push(projectCard(view));
    return parts;
  }

  function draw(): void {
    if (disposed) return;
    switch (phase.name) {
      case 'loading':
        root.replaceChildren(el('p', 'muted', ['Loading the map…']));
        return;
      case 'failed':
        root.replaceChildren(note(phase.message, 'err'));
        return;
      case 'ready':
        root.replaceChildren(...drawReady(phase.project, phase.view));
    }
  }

  /** Reads the store again without leaving the screen; a failure shows above the map it had. */
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
    // An agent that went quiet after working, or that stopped, may have changed the map, the tickets or their tags.
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
