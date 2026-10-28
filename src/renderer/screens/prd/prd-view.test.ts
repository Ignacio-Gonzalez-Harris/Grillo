// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerStoreIpc } from '../../../main/features/store/ipc';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { formatPrdVersion } from '../../../main/store/github/repo/records';
import { createMemoryStore, type MemoryStore } from '../../../main/store/memory';
import { createMemorySettings } from '../../../main/store/memory/settings';
import type { Store } from '../../../main/store/store';
import { createGrilloApi } from '../../../preload/bridge';
import type { AgentInfo, StartAgentRequest } from '../../../shared/agents';
import { createStoreClient, StoreError } from '../../../shared/store';
import { registerScreens, type ScreenModule } from '../../app/screens';
import { createShell, type Shell } from '../../app/shell';
import type { ExportFile } from './export';
import * as prdScreen from './index';
import { readVersions } from './data';
import { mountPrdView, NO_PROJECT } from './prd-view';

// Made-up project, members and PRD text only.
const PROJECT = 'example-org/sample-project-1';
const FOLDER = '/memory/Grillo/example-org/sample-project-1';
const V1 = {
  body: '# Sample PRD\n\n## Sample section 1\n\n- Sample decision statement one. [S1, Q2.1]\n',
  appendix: '# Audit appendix\n\n## Sources\n\n### S1\n- Who: sample-member\n\n> Sample source words.\n',
};
const V2 = {
  body: '# Sample PRD\n\n## Sample section 1\n\n- Sample decision statement two. [S1, Q2.1]\n- Sample statement that no answer supports. [no source]\n',
  appendix:
    '# Audit appendix\n\n## Sources\n\n### S1\n- Who: sample-member\n\n## Questions\n\n### Q2.1\n- Question: A made-up question?\n\n## Unsourced\n\n- Sample section 1: Sample statement that no answer supports.\n',
};

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

let shell: Shell | undefined;

afterEach(() => {
  shell?.dispose();
  shell = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * The app as it runs, in process: the in-memory store behind the real store IPC, a stand-in agent runtime that only
 * records what is started, and the shell with this screen registered as discovery would.
 */
async function app(options: { opened?: boolean; startFails?: string } = {}) {
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const store: MemoryStore = createMemoryStore({ now: () => new Date('2026-10-22T10:00:00.000Z') });
  registerStoreIpc(ipc, store, createMemorySettings());

  let running: AgentInfo[] = [];
  const starts: StartAgentRequest[] = [];
  const setAgents = (list: AgentInfo[]) => {
    running = list;
    ipc.send('agents:list-changed', list);
  };
  ipc.handle('agents:list', () => running);
  ipc.handle('agents:start', (request) => {
    if (options.startFails) throw new Error(options.startFails);
    starts.push(request);
    const id = `agent-${starts.length}`;
    setAgents([...running, { id, kind: request.kind, title: request.title, folder: request.folder, waiting: false }]);
    return id;
  });

  await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } });
  if (options.opened !== false) await store.openProjectFolder(PROJECT);

  const visited: Array<{ screenId: string; params: Record<string, string> }> = [];
  const recorder = (screenId: string): ScreenModule => ({
    id: screenId,
    title: screenId,
    mount: (_el, params) => {
      visited.push({ screenId, params: { ...params } });
    },
  });
  const saved: ExportFile[] = [];
  const root = document.createElement('div');
  document.body.append(root);
  const prd: ScreenModule = {
    id: prdScreen.id,
    title: prdScreen.title,
    mount: (el, params, context) =>
      mountPrdView(el, params, {
        store: createStoreClient(context.grillo),
        grillo: context.grillo,
        navigate: context.navigate,
        onAgents: context.onAgentTabs,
        save: (file) => saved.push(file),
      }),
  };
  const grillo = createGrilloApi(fake.renderer);
  shell = createShell(root, {
    grillo,
    screens: registerScreens({
      '/src/renderer/screens/prd/index.ts': prd,
      '/src/renderer/screens/map/index.ts': recorder('map'),
      '/src/renderer/screens/project-creation/index.ts': recorder('project-creation'),
      '/src/renderer/screens/agent-tab/index.ts': recorder('agent-tab'),
    }),
  });
  const content = () => root.querySelector('main') as HTMLElement;
  return {
    store,
    starts,
    saved,
    visited,
    content,
    setAgents,
    writer: (waiting: boolean): AgentInfo => ({ id: 'writer-1', kind: 'grilling', title: 'Grilling · PRD', folder: FOLDER, waiting }),
    async openPrdTab() {
      const tab = [...root.querySelectorAll<HTMLButtonElement>('nav .tab')].find((each) => text(each) === 'PRD');
      tab?.click();
      await flush();
    },
  };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const texts = (els: Iterable<Element>) => [...els].map(text);
const buttonNamed = (scope: Element, label: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => text(candidate) === label);
async function click(scope: Element, label: string): Promise<void> {
  const target = buttonNamed(scope, label);
  if (!target) throw new Error(`No button '${label}' in: ${scope.textContent}`);
  target.click();
  await flush();
}
const versionRow = (content: HTMLElement, number: number) =>
  [...content.querySelectorAll('ul[aria-label="Versions"] > li')].find((row) => text(row.querySelector('.strong')) === `Version ${number}`) as Element;

describe('PRD view: registration', () => {
  it('registers under the id the PRD tab opens, through screen discovery', () => {
    const registry = registerScreens({ '/src/renderer/screens/prd/index.ts': prdScreen });
    expect(registry.get('prd')?.title).toBe('PRD');
  });
});

describe('PRD view: which project', () => {
  it('asks for a project when the member has opened none', async () => {
    const { content, openPrdTab } = await app({ opened: false });
    await openPrdTab();
    expect(text(content().querySelector('.note.warn'))).toBe(NO_PROJECT);
  });

  it('shows the project the screen was opened with', async () => {
    const { store, content } = await app({ opened: false });
    await store.createPrdVersion(PROJECT, V1);
    shell?.navigate('prd', { project: PROJECT });
    await flush();
    expect(text(content().querySelector('h3'))).toBe('PRD · version 1');
  });
});

describe('PRD view: No version yet', () => {
  it('says the PRD is written when the map is done, what is still left, and opens the map', async () => {
    const { store, content, visited, openPrdTab } = await app();
    await store.createMap(PROJECT, { destination: 'A PRD for a sample product', notes: '', fog: ['Sample section 1: a made-up unknown'], outOfScope: [] });
    for (const title of ['Sample ticket 1', 'Sample ticket 2', 'Sample ticket 3']) {
      await store.createTicket(PROJECT, { title, question: 'A made-up question?', whyItMatters: '', assumptions: [], kind: 'grilling', blockers: [], questions: [] });
    }
    const closed = await store.createTicket(PROJECT, { title: 'Sample ticket 4', question: 'A made-up question?', whyItMatters: '', assumptions: [], kind: 'grilling', blockers: [], questions: [] });
    await store.closeTicket(closed.id);

    await openPrdTab();

    const card = content().querySelector('.prd-view > .card') as HTMLElement;
    expect(text(card.querySelector('h3'))).toBe('No PRD yet');
    expect(text(card.querySelector('p'))).toBe(
      'Grillo writes the PRD automatically the moment the map is done. Still left: 3 open tickets and 1 fog item.',
    );
    await click(card, 'Open the map');
    expect(visited.at(-1)).toEqual({ screenId: 'map', params: { project: PROJECT } });
  });

  it('leaves out what is left while the project has no map yet', async () => {
    const { content, openPrdTab } = await app();
    await openPrdTab();
    expect(text(content().querySelector('.prd-view > .card p'))).toBe('Grillo writes the PRD automatically the moment the map is done.');
  });
});

describe('PRD view: Writing', () => {
  it('shows Writing while a PRD writer of this project works, then the new version once it finishes', async () => {
    const { store, content, setAgents, writer, visited, openPrdTab } = await app();
    setAgents([writer(false), { ...writer(false), id: 'other-project', folder: '/memory/Grillo/example-org/another' }]);
    await openPrdTab();

    const card = content().querySelector('.prd-view > .card') as HTMLElement;
    expect(text(card.querySelector('h3'))).toBe('Writing version 1');
    expect(text(card.querySelector('.badge.warn'))).toBe('Working…');
    expect(text(card.querySelector('p'))).toBe(
      "Working through every answer, discussion and session transcript in stages, in this project's PRD structure.",
    );
    await click(card, 'Open the writer');
    expect(visited.at(-1)).toEqual({ screenId: 'agent-tab', params: { agentId: 'writer-1' } });

    shell?.navigate('prd');
    await flush();
    await store.createPrdVersion(PROJECT, V1);
    setAgents([writer(true)]);
    await flush();

    expect(content().textContent).not.toContain('Writing version');
    expect(text(content().querySelector('h3'))).toBe('PRD · version 1');
  });

  it('shows Writing when the map is done and the agent that closed the last ticket writes the PRD in its own tab', async () => {
    const { store, content, setAgents, visited, openPrdTab } = await app();
    await store.createMap(PROJECT, { destination: 'A PRD for a sample product', notes: '', fog: [], outOfScope: [] });
    const last = await store.createTicket(PROJECT, { title: 'Sample ticket 3', question: 'A made-up question?', whyItMatters: '', assumptions: [], kind: 'grilling', blockers: [], questions: [] });
    await store.closeTicket(last.id);
    const closer: AgentInfo = { id: 'closer-1', kind: 'grilling', title: 'Grilling · Sample ticket 3', folder: FOLDER, waiting: false };
    setAgents([closer, { ...closer, id: 'other', folder: '/memory/Grillo/example-org/another' }]);
    await openPrdTab();

    const card = content().querySelector('.prd-view > .card') as HTMLElement;
    expect(text(card.querySelector('h3'))).toBe('Writing version 1');
    await click(card, 'Open the writer');
    expect(visited.at(-1)).toEqual({ screenId: 'agent-tab', params: { agentId: 'closer-1' } });

    shell?.navigate('prd');
    await flush();
    await store.createPrdVersion(PROJECT, V1);
    setAgents([{ ...closer, waiting: true }]);
    await flush();

    expect(content().textContent).not.toContain('Writing version');
    expect(text(content().querySelector('h3'))).toBe('PRD · version 1');
  });

  it('says nothing is left, not Writing, when the map is done but no agent of the project runs', async () => {
    const { store, content, openPrdTab } = await app();
    await store.createMap(PROJECT, { destination: 'A PRD for a sample product', notes: '', fog: [], outOfScope: [] });
    await openPrdTab();
    expect(text(content().querySelector('.prd-view > .card p'))).toBe(
      'Grillo writes the PRD automatically the moment the map is done. Still left: 0 open tickets and 0 fog items.',
    );
  });

  it('ignores a writer of another project and one waiting for the member', async () => {
    const { content, setAgents, writer, openPrdTab } = await app();
    setAgents([writer(true), { ...writer(false), id: 'other', folder: '/memory/Grillo/example-org/another' }]);
    await openPrdTab();
    expect(text(content().querySelector('h3'))).toBe('No PRD yet');
  });
});

describe('PRD view: Versions list', () => {
  async function withTwoVersions() {
    const context = await app();
    await context.store.createPrdVersion(PROJECT, V1);
    await context.store.createPrdVersion(PROJECT, V2);
    await context.openPrdTab();
    return context;
  }

  it('shows the latest version with its codes and appendix, and every version numbered and dated', async () => {
    const { content } = await withTwoVersions();

    const heading = content().querySelector('.split > .stack > .row') as HTMLElement;
    expect(text(heading.querySelector('h3'))).toBe('PRD · version 2');
    expect(text(heading.querySelector('.badge.info'))).toBe('Latest');
    expect(text(heading.querySelector('.muted'))).toBe('2026-10-22');
    expect(texts(heading.querySelectorAll('button'))).toEqual(['Talk to an agent about this PRD', 'Edit structure and regenerate', 'Regenerate']);

    const doc = content().querySelector('article.prd-doc') as HTMLElement;
    expect(text(doc)).toContain('Sample decision statement two.');
    expect(texts(doc.querySelectorAll('.code-chip'))).toEqual(['[S1, Q2.1]', '[no source]']);
    expect(doc.querySelector('.code-chip.nosrc')).not.toBeNull();
    const appendix = doc.querySelector('.appendix') as HTMLElement;
    expect(texts(appendix.querySelectorAll('[id]'))).toEqual(['S1', 'Q2.1']);
    expect(text(appendix)).toContain('Unsourced');

    const rows = [...content().querySelectorAll('ul[aria-label="Versions"] > li')];
    expect(rows.map((row) => texts(row.querySelectorAll('.grow > *:not(br)')))).toEqual([
      ['Version 2', 'Latest', '2026-10-22'],
      ['Version 1', '2026-10-22'],
    ]);
    expect(rows[0].classList.contains('selected')).toBe(true);
    expect(texts(rows[1].querySelectorAll('button'))).toEqual(['Open', 'Markdown', 'HTML']);
    expect(text(content().querySelector('.split > .card > p'))).toBe('Every version is kept, numbered and dated.');
  });

  it('opens an earlier version, kept beside the latest', async () => {
    const { content } = await withTwoVersions();

    await click(versionRow(content(), 1), 'Open');

    const heading = content().querySelector('.split > .stack > .row') as HTMLElement;
    expect(text(heading.querySelector('h3'))).toBe('PRD · version 1');
    expect(heading.querySelector('.badge')).toBeNull();
    expect(text(content().querySelector('article.prd-doc'))).toContain('Sample decision statement one.');
    expect(versionRow(content(), 1).classList.contains('selected')).toBe(true);
    expect(versionRow(content(), 2).classList.contains('selected')).toBe(false);
  });

  it('jumps from a code chip to its entry in the audit appendix', async () => {
    const { content } = await withTwoVersions();
    const scrolled = vi.fn();
    const doc = content().querySelector('article.prd-doc') as HTMLElement;
    const entry = [...doc.querySelectorAll('[id]')].find(({ id }) => id === 'code-Q2.1') as HTMLElement;
    entry.scrollIntoView = scrolled;

    const link = [...doc.querySelectorAll('.code-chip a')].find((each) => text(each) === 'Q2.1') as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(scrolled).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('downloads the shown version as its stored Markdown file and as one HTML file, from the export row and the list', async () => {
    const { store, content, saved } = await withTwoVersions();
    const [v2, v1] = [await store.getPrdVersion(PROJECT, 2), await store.getPrdVersion(PROJECT, 1)];

    await click(content(), 'Download Markdown');
    await click(content(), 'Download HTML');
    await click(versionRow(content(), 1), 'Markdown');
    await click(versionRow(content(), 1), 'HTML');

    expect(saved.map(({ name, type }) => [name, type])).toEqual([
      ['sample-project-1-prd-v2.md', 'text/markdown'],
      ['sample-project-1-prd-v2.html', 'text/html'],
      ['sample-project-1-prd-v1.md', 'text/markdown'],
      ['sample-project-1-prd-v1.html', 'text/html'],
    ]);
    expect(saved[0].content).toBe(formatPrdVersion(v2));
    expect(saved[2].content).toBe(formatPrdVersion(v1));
    expect(saved[1].content).toContain('Sample decision statement two.');
    expect(saved[3].content).toContain('Sample decision statement one.');
  });

  it('Regenerate starts the PRD writer with /grillo-prd regenerate and shows Writing above the kept versions', async () => {
    const { content, starts } = await withTwoVersions();

    await click(content(), 'Regenerate');

    expect(starts).toEqual([{ kind: 'grilling', folder: FOLDER, firstMessage: '/grillo-prd regenerate', title: 'Grilling · PRD' }]);
    expect(text(content().querySelector('.prd-view > .card h3'))).toBe('Writing version 3');
    expect(text(content().querySelector('.split h3'))).toBe('PRD · version 2');
    expect(buttonNamed(content(), 'Regenerate')?.disabled).toBe(true);
  });

  it('Talk to an agent starts a grilling agent with /grillo-prd feedback and opens its tab', async () => {
    const { content, starts, visited } = await withTwoVersions();

    await click(content(), 'Talk to an agent about this PRD');

    expect(starts).toEqual([{ kind: 'grilling', folder: FOLDER, firstMessage: '/grillo-prd feedback', title: 'Grilling · PRD feedback' }]);
    expect(visited.at(-1)).toEqual({ screenId: 'agent-tab', params: { agentId: 'agent-1' } });
  });

  it('Edit structure and regenerate opens the structure editor on the project screen', async () => {
    const { content, visited } = await withTwoVersions();

    await click(content(), 'Edit structure and regenerate');

    expect(visited.at(-1)).toEqual({ screenId: 'project-creation', params: { project: PROJECT, view: 'structure' } });
  });
});

describe('PRD view: refusals', () => {
  it('shows a store refusal as an error', async () => {
    const { store, content, openPrdTab } = await app();
    vi.spyOn(store, 'listPrdVersions').mockRejectedValue(new StoreError('backend', 'GitHub could not be reached.'));
    await openPrdTab();
    expect(text(content().querySelector('.note.err'))).toBe('GitHub could not be reached.');
  });

  it('shows why an agent could not start, and keeps the version on show', async () => {
    const context = await app({ startFails: 'Claude Code is not installed on this laptop' });
    await context.store.createPrdVersion(PROJECT, V1);
    await context.openPrdTab();

    await click(context.content(), 'Regenerate');

    expect(text(context.content().querySelector('.note.err'))).toContain('Claude Code is not installed on this laptop');
    expect(text(context.content().querySelector('.split h3'))).toBe('PRD · version 1');
    expect(buttonNamed(context.content(), 'Regenerate')?.disabled).toBe(false);
  });

  it.each([
    ['no list', null],
    ['a null version', [null]],
    ['a version with no number', [{ date: 'x', body: '', appendix: '' }]],
    ['a version numbered zero', [{ number: 0, date: 'x', body: '', appendix: '' }]],
    ['a version with no body', [{ number: 1, date: 'x', appendix: '' }]],
  ])('refuses %s from the store as one backend error', async (_case, listed) => {
    const store = { listPrdVersions: async () => listed } as unknown as Store;
    await expect(readVersions(store, PROJECT)).rejects.toMatchObject({ kind: 'backend', message: `Grillo could not read the PRD versions of ${PROJECT} from the store.` });
  });

  it('keeps each version number once and lists the newest first', async () => {
    const version = (number: number, body: string) => ({ number, date: '2026-10-22T10:00:00.000Z', body, appendix: '', score: null });
    const store = { listPrdVersions: async () => [version(1, 'first'), version(2, 'second'), version(1, 'again')] } as unknown as Store;
    expect((await readVersions(store, PROJECT)).map(({ number, body }) => [number, body])).toEqual([
      [2, 'second'],
      [1, 'first'],
    ]);
  });
});

describe('PRD view: Score', () => {
  // A made-up score of the made-up PRD above.
  const score = (overall: number, comment: string) => ({
    overall,
    criteria: [{ name: 'Clear', mark: 8, comment: `${comment} Suggestion: none.` }],
    sections: [{ name: 'Sample section 1', mark: 5, comment: 'Sample section comment. Suggestion: add an outcome.' }],
  });

  async function scored() {
    const context = await app();
    await context.store.createPrdVersion(PROJECT, V1);
    await context.store.createPrdVersion(PROJECT, V2);
    await context.store.setScore(PROJECT, 1, score(5.8, 'Sample comment on version 1.'));
    await context.store.setScore(PROJECT, 2, score(6.3, 'Sample comment on version 2.'));
    await context.openPrdTab();
    return context;
  }
  const panel = (content: HTMLElement) => content.querySelector('.split > .stack > [role="region"]') as HTMLElement;

  it('shows the score of the version on show beside it, and each version its score in the list', async () => {
    const { content } = await scored();

    expect(panel(content()).getAttribute('aria-label')).toBe('Score of version 2');
    expect(text(panel(content()).querySelector('.score-big'))).toBe('6.3');
    expect(text(panel(content()))).toContain('Sample comment on version 2.');
    expect(panel(content()).nextElementSibling?.matches('article.prd-doc')).toBe(true);
    expect(texts(versionRow(content(), 2).querySelectorAll('.badge'))).toEqual(['Latest', 'Score 6.3']);
    expect(texts(versionRow(content(), 1).querySelectorAll('.badge'))).toEqual(['Score 5.8']);

    await click(versionRow(content(), 1), 'Open');

    expect(panel(content()).getAttribute('aria-label')).toBe('Score of version 1');
    expect(text(panel(content()))).toContain('Sample comment on version 1.');
    expect(buttonNamed(panel(content()), 'Rerun')).toBeUndefined();
  });

  it('Rerun starts /grillo-score, holds itself while the scorer works, then shows the new score', async () => {
    const { content, starts, store, setAgents } = await scored();

    await click(panel(content()), 'Rerun');

    expect(starts).toEqual([{ kind: 'grilling', folder: FOLDER, firstMessage: '/grillo-score', title: 'Grilling · PRD score' }]);
    expect(buttonNamed(panel(content()), 'Rerun')?.disabled).toBe(true);
    expect(text(panel(content()).querySelector('.badge.warn'))).toBe('Scoring…');

    await store.setScore(PROJECT, 2, score(7.4, 'Sample comment after the rerun.'));
    setAgents([]);
    await flush();

    expect(text(panel(content()).querySelector('.score-big'))).toBe('7.4');
    expect(text(panel(content()))).toContain('Sample comment after the rerun.');
    expect(buttonNamed(panel(content()), 'Rerun')?.disabled).toBe(false);
  });

  it('labels only the latest version Scoring while a Rerun runs, since an earlier score does not change', async () => {
    const { content } = await scored();

    await click(panel(content()), 'Rerun');
    await click(versionRow(content(), 1), 'Open');

    expect(panel(content()).getAttribute('aria-label')).toBe('Score of version 1');
    expect(text(panel(content()))).not.toContain('Scoring…');
  });

  it('shows a score it cannot read as an error in the panel, and keeps the PRD on show', async () => {
    const { store, content, openPrdTab } = await app();
    await store.createPrdVersion(PROJECT, V1);
    const [version] = await store.listPrdVersions(PROJECT);
    vi.spyOn(store, 'listPrdVersions').mockResolvedValue([{ ...version, score: { overall: 6, criteria: null } as never }]);
    await openPrdTab();

    expect(text(panel(content()).querySelector('.note.err'))).toBe('Grillo could not read the score of version 1 from the store.');
    expect(text(content().querySelector('article.prd-doc'))).toContain('Sample decision statement one.');
    expect(texts(versionRow(content(), 1).querySelectorAll('.badge'))).toEqual(['Latest']);
  });
});
