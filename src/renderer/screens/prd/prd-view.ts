/**
 * The PRD view (PRD section 4.7 items 4-6, section 5 screen 8; prototype `screen-prd-view`): the latest PRD version
 * with its trace codes and audit appendix, every kept version numbered and dated with Open, Markdown and HTML, the
 * export of the version on show, Regenerate, Edit structure and regenerate, and Talk to an agent about this PRD.
 * Opened with `{ project: '<owner>/<repo>' }`, or with nothing for the project opened last.
 *
 * Its three states follow the prototype: No version yet, Writing (a PRD writer of this project is still working),
 * and the Versions list.
 */
import './prd-doc.css';
import './prd-view.css';
import type { Store } from '../../../main/store/store';
import type { PrdVersion, ProjectId } from '../../../main/store/types';
import type { AgentId, AgentInfo } from '../../../shared/agents';
import type { GrilloApi, Unsubscribe } from '../../../shared/ipc';
import { AGENT_SCREEN } from '../../app/navigation';
import type { ScreenParams } from '../../app/screens';
import { badge, button } from '../../theme/components';
import { el, messageOf, note } from '../own-time/view';
import { startFeedback, startRegenerate, workingWriters } from './agents';
import { projectFolder, projectToShow, readLeftOnMap, readVersions, type LeftOnMap } from './data';
import { dayOf, exportFile, versionTitle, type ExportFile, type ExportFormat } from './export';
import { renderPrdVersion } from './render';

/** The screen and parameters "Edit structure and regenerate" opens: the structure editor on the project screen. */
export const STRUCTURE_EDITOR = { screenId: 'project-creation', view: 'structure' } as const;
/** The map screen "Open the map" opens. */
export const MAP_SCREEN = 'map';

export const NO_PROJECT = 'Open a project from the Project tab to read its PRD here.';
const WRITING_TEXT = "Working through every answer, discussion and session transcript in stages, in this project's PRD structure.";
const NO_VERSION_TEXT = 'Grillo writes the PRD automatically the moment the map is done.';
const KEPT_TEXT = 'Every version is kept, numbered and dated.';

export interface PrdViewDeps {
  store: Store;
  grillo: GrilloApi;
  navigate(screenId: string, params?: ScreenParams): void;
  /** The running agents now, then after every change (the shell's `onAgentTabs`). */
  onAgents(listener: (agents: readonly AgentInfo[]) => void): Unsubscribe;
  /** Hands an exported file to the member to save. */
  save(file: ExportFile): void;
}

interface Project {
  id: ProjectId;
  folder: string;
  /** Newest first. */
  versions: PrdVersion[];
  /** What is still left on the map; only read while no version exists. */
  left: LeftOnMap | null;
}

type Phase =
  | { name: 'loading' }
  | { name: 'failed'; message: string }
  | { name: 'no-project' }
  | { name: 'ready'; project: Project };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Still left: 3 open tickets and 1 fog item." */
export function stillLeft(left: LeftOnMap): string {
  return `Still left: ${plural(left.openTickets, 'open ticket', 'open tickets')} and ${plural(left.fog, 'fog item', 'fog items')}.`;
}

export function mountPrdView(container: HTMLElement, params: ScreenParams, deps: PrdViewDeps): () => void {
  const { store, grillo, navigate } = deps;
  const root = el('div', 'prd-view');
  container.replaceChildren(root);

  let disposed = false;
  let phase: Phase = { name: 'loading' };
  let agents: readonly AgentInfo[] = [];
  /** The version on show; null shows the latest. */
  let shown: number | null = null;
  let busy = false;
  let actionError: string | null = null;
  /** A writer this screen started that the agent list does not show yet: it counts as writing meanwhile. */
  let startedWriter: AgentId | null = null;
  let wasWriting = false;

  function set(next: Phase): void {
    if (disposed) return;
    phase = next;
    draw();
  }

  function writers(project: Project): AgentInfo[] {
    return workingWriters(agents, project.folder);
  }

  function isWriting(project: Project): boolean {
    return writers(project).length > 0 || startedWriter !== null;
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

  async function read(id: ProjectId, folder?: string): Promise<Project> {
    const [versions, knownFolder] = await Promise.all([readVersions(store, id), folder ?? projectFolder(store, id)]);
    const left = versions.length === 0 ? await readLeftOnMap(store, id) : null;
    return { id, folder: knownFolder, versions, left };
  }

  async function reload(project: Project): Promise<void> {
    try {
      set({ name: 'ready', project: await read(project.id, project.folder) });
    } catch (error) {
      set({ name: 'failed', message: messageOf(error) });
    }
  }

  function regenerate(project: Project): Promise<void> {
    return act(async () => {
      const writer = await startRegenerate(grillo, project.folder);
      // The agent list may already show it, when its change arrived before this answer.
      startedWriter = agents.some(({ id }) => id === writer) ? null : writer;
      wasWriting = true;
    });
  }

  function talkToAgent(project: Project): Promise<void> {
    return act(async () => {
      const agentId = await startFeedback(grillo, project.folder);
      if (!disposed) navigate(AGENT_SCREEN, { agentId });
    });
  }

  function download(project: Project, version: PrdVersion, format: ExportFormat): void {
    try {
      deps.save(exportFile(format, project.id, version));
    } catch (error) {
      actionError = messageOf(error);
      draw();
    }
  }

  function writingCard(project: Project): HTMLElement {
    const next = (project.versions[0]?.number ?? 0) + 1;
    const card = el('div', 'card stack', [
      el('div', 'row', [el('h3', 'm0', [`Writing version ${next}`]), badge('Working…', 'warn')]),
      el('p', 'muted', [WRITING_TEXT]),
    ]);
    const writer = writers(project)[0]?.id ?? startedWriter;
    if (writer !== null) {
      card.append(el('div', 'row', [button('Open the writer', { small: true, onClick: () => navigate(AGENT_SCREEN, { agentId: writer }) })]));
    }
    return card;
  }

  function noVersionCard(project: Project): HTMLElement {
    const text = project.left === null ? NO_VERSION_TEXT : `${NO_VERSION_TEXT} ${stillLeft(project.left)}`;
    return el('div', 'card stack', [
      el('h3', 'm0', ['No PRD yet']),
      el('p', 'muted', [text]),
      el('div', 'row', [button('Open the map', { onClick: () => navigate(MAP_SCREEN, { project: project.id }) })]),
    ]);
  }

  function documentOf(version: PrdVersion): HTMLElement {
    const article = el('article', 'card prd-doc');
    article.innerHTML = renderPrdVersion(version);
    // A code chip jumps to its entry in the appendix without changing the app's address.
    article.addEventListener('click', (event) => {
      const link = (event.target as Element | null)?.closest('a');
      const target = link?.getAttribute('href') ?? '';
      if (!target.startsWith('#')) return;
      event.preventDefault();
      const wanted = target.slice(1);
      const entry = [...article.querySelectorAll('[id]')].find(({ id }) => id === wanted);
      entry?.scrollIntoView({ block: 'start' });
    });
    return article;
  }

  function versionRow(project: Project, version: PrdVersion, latest: boolean, selected: boolean): HTMLLIElement {
    const name = el('span', 'strong', [`Version ${version.number}`]);
    const about = el('div', 'grow full', [name, ...(latest ? [' ', badge('Latest', 'info')] : []), el('br', ''), el('span', 'muted', [dayOf(version.date)])]);
    const actions = el('span', 'row', [
      button('Open', {
        small: true,
        onClick: () => {
          shown = version.number;
          draw();
        },
      }),
      button('Markdown', { small: true, onClick: () => download(project, version, 'markdown') }),
      button('HTML', { small: true, onClick: () => download(project, version, 'html') }),
    ]);
    actions.setAttribute('aria-label', `Version ${version.number}`);
    const row = el('li', selected ? 'selected' : '', [about, actions]);
    if (selected) row.setAttribute('aria-current', 'true');
    return row;
  }

  function versionsView(project: Project, writing: boolean): HTMLElement {
    const latest = project.versions[0];
    const version = project.versions.find(({ number }) => number === shown) ?? latest;
    const isLatest = version.number === latest.number;
    const heading = el('div', 'row', [
      el('h3', 'm0', [versionTitle(version.number)]),
      ...(isLatest ? [badge('Latest', 'info')] : []),
      el('span', 'muted small', [dayOf(version.date)]),
      el('span', 'spacer'),
      button('Talk to an agent about this PRD', { disabled: busy, onClick: () => void talkToAgent(project) }),
      button('Edit structure and regenerate', {
        disabled: busy,
        onClick: () => navigate(STRUCTURE_EDITOR.screenId, { project: project.id, view: STRUCTURE_EDITOR.view }),
      }),
      button('Regenerate', { disabled: busy || writing, onClick: () => void regenerate(project) }),
    ]);
    const exportRow = el('div', 'row', [
      el('span', 'small strong muted', ['Export']),
      button('Download Markdown', { variant: 'primary', small: true, onClick: () => download(project, version, 'markdown') }),
      button('Download HTML', { variant: 'primary', small: true, onClick: () => download(project, version, 'html') }),
    ]);
    const main = el('div', 'stack', [heading, exportRow, ...(actionError ? [note(actionError, 'err')] : []), documentOf(version)]);

    const rows = el(
      'ul',
      'rows small',
      project.versions.map((each) => versionRow(project, each, each.number === latest.number, each.number === version.number)),
    );
    rows.setAttribute('aria-label', 'Versions');
    const side = el('div', 'card stack', [el('h4', '', ['Versions']), rows, el('p', 'small muted', [KEPT_TEXT])]);
    return el('div', 'split rev', [main, side]);
  }

  function draw(): void {
    switch (phase.name) {
      case 'loading':
        root.replaceChildren(el('p', 'muted', ['Loading the PRD…']));
        return;
      case 'failed':
        root.replaceChildren(note(phase.message, 'err'));
        return;
      case 'no-project':
        root.replaceChildren(note(NO_PROJECT, 'warn'));
        return;
      case 'ready': {
        const { project } = phase;
        const writing = isWriting(project);
        const parts: HTMLElement[] = [];
        if (writing) parts.push(writingCard(project));
        if (project.versions.length > 0) parts.push(versionsView(project, writing));
        else if (!writing) parts.push(noVersionCard(project), ...(actionError ? [note(actionError, 'err')] : []));
        root.replaceChildren(...parts);
      }
    }
  }

  /** Follows the agent list: once every writer of this project has finished, the new version is read. */
  function showAgents(list: readonly AgentInfo[]): void {
    agents = list;
    if (phase.name !== 'ready') return;
    const { project } = phase;
    if (startedWriter !== null && list.some(({ id }) => id === startedWriter)) startedWriter = null;
    const writing = isWriting(project);
    const finished = wasWriting && !writing;
    wasWriting = writing;
    draw();
    if (finished) void reload(project);
  }

  async function load(): Promise<void> {
    try {
      const id = await projectToShow(store, params);
      if (id === null) {
        set({ name: 'no-project' });
        return;
      }
      const project = await read(id);
      wasWriting = workingWriters(agents, project.folder).length > 0;
      set({ name: 'ready', project });
    } catch (error) {
      set({ name: 'failed', message: messageOf(error) });
    }
  }

  draw();
  const stopAgents = deps.onAgents(showAgents);
  void load();

  return () => {
    disposed = true;
    stopAgents();
  };
}
