// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerStoreIpc } from '../../../main/features/store/ipc';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { DEFAULT_PRD_STRUCTURE } from '../../../main/store/defaults';
import { createMemoryStore, type MemoryStore, type MemoryStoreOptions } from '../../../main/store/memory';
import { createMemorySettings } from '../../../main/store/memory/settings';
import { createGrilloApi } from '../../../preload/bridge';
import type { StartAgentRequest } from '../../../shared/agents';
import { APP_TABS } from '../../app/navigation';
import type { ScreenParams, ShellContext } from '../../app/screens';
import * as screen from './index';
import { LAST_MEMBERSHIP_KEY } from './membership';
import { UNSTARTED_AGENTS_KEY } from './unstarted';

// Made-up organisations, people, repositories and ideas only.
const NOW = new Date('2026-10-22T10:00:00.000Z');
const IDEA = 'Sample idea: a short description of the product, written in the member\'s own words.';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await flush();
  }
  throw new Error(`Timed out waiting for ${what}; the screen shows: ${document.body.textContent}`);
}

interface AppOptions {
  seed?: MemoryStoreOptions['seed'];
  failAgentStarts?: number;
  /** The GitHub identity cannot be read (gh signed out), so the screen does not know who "you" are. */
  noIdentity?: boolean;
}

/** The screen as it runs: the in-memory store and the settings behind the real store IPC, agents recorded. */
function app(options: AppOptions = {}) {
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const store: MemoryStore = createMemoryStore({ now: () => NOW, seed: options.seed });
  const settings = createMemorySettings();
  registerStoreIpc(ipc, store, settings);
  const starts: StartAgentRequest[] = [];
  let failures = options.failAgentStarts ?? 0;
  ipc.handle('agents:start', (request) => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('Claude Code is not installed on this laptop');
    }
    starts.push(request);
    return `agent-${starts.length}`;
  });
  ipc.handle('tools:identity', () =>
    options.noIdentity
      ? { ok: false as const, reason: 'signed-out' as const }
      : { ok: true as const, identity: { login: 'ada-example', name: 'Ada Example', email: null } },
  );

  const navigate = vi.fn<(screenId: string, params?: ScreenParams) => void>();
  const shell: ShellContext = {
    grillo: createGrilloApi(fake.renderer),
    navigate,
    agentTabHeader: () => undefined,
    onAgentTabs: () => () => undefined,
    showProject: () => undefined,
  };
  const root = document.createElement('div');
  document.body.append(root);
  return {
    store,
    settings,
    starts,
    navigate,
    root,
    async open(params: ScreenParams = {}) {
      screen.mount(root, params, shell);
      await until(() => root.querySelector('.project-creation > p.muted') === null, 'the screen to load');
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? '';
const texts = (els: Iterable<Element>) => [...els].map(text);
const buttonNamed = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => text(candidate) === label);
function click(scope: ParentNode, label: string): void {
  const target = buttonNamed(scope, label);
  if (!target) throw new Error(`No button '${label}' in: ${(scope as Element).textContent}`);
  target.click();
}
function type(scope: ParentNode, selector: string, value: string): void {
  const field = scope.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!field) throw new Error(`No field ${selector}`);
  field.value = value;
  field.dispatchEvent(new Event('input'));
}
const cardTitled = (root: HTMLElement, title: string) =>
  [...root.querySelectorAll<HTMLElement>('.card')].find((card) => text(card.querySelector('h3')).startsWith(title)) as HTMLElement;
const sectionNames = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLInputElement>('input[aria-label="Section name"]')].map((input) => input.value);

type Page = 'Where' | 'Structure' | 'People' | 'Idea' | 'Review';
const PAGES: readonly Page[] = ['Where', 'Structure', 'People', 'Idea', 'Review'];
/** The page of the guided steps on screen: the step the stepper marks, or the review page, or null off the steps. */
const pageNow = (root: HTMLElement): Page | null => {
  if (root.querySelector('.review') !== null) return 'Review';
  return (text(root.querySelector('.stepper [aria-current="step"]')) as Page) || null;
};
/** The one card of the step on screen, which holds that step's fields. */
const stepCard = (root: HTMLElement) => root.querySelector('.card') as HTMLElement;
/** Presses Next until the page shows; a Next that stays put is a failure of the test that asked for this walk. */
function walkTo(root: HTMLElement, page: Page): void {
  while (pageNow(root) !== page) {
    const before = pageNow(root);
    if (before === null || PAGES.indexOf(before) > PAGES.indexOf(page)) throw new Error(`Cannot walk from ${before} to ${page}`);
    click(root, 'Next');
    if (pageNow(root) === before) throw new Error(`Next stayed on ${before}: ${text(root.querySelector('.note.err'))}`);
  }
}
const onWhere = (root: HTMLElement) => pageNow(root) === 'Where';
const value = (root: ParentNode, selector: string) => root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value;
const PROJECT_NAME = 'input[aria-label="Project name"]';
const REPOSITORY_NAME = 'input[aria-label="Repository name"]';
const THE_IDEA = 'textarea[aria-label="The idea"]';
const SEARCH = 'input[aria-label="Search repositories"]';
const INVITE_LOGIN = 'input[aria-label="GitHub login to invite"]';
/** From Where on New project: names the repository, gives the idea and stops on the review page. */
function fillNewProject(root: HTMLElement, name = 'sample-project-1'): void {
  type(root, REPOSITORY_NAME, name);
  walkTo(root, 'Idea');
  type(root, THE_IDEA, IDEA);
  walkTo(root, 'Review');
}
/** From Where on Connect existing, with a repository chosen: gives the idea and stops on the review page. */
function fillConnection(root: HTMLElement): void {
  walkTo(root, 'Idea');
  type(root, THE_IDEA, IDEA);
  walkTo(root, 'Review');
}

describe('project creation: your projects and invitations', () => {
  it('lists recent projects, last opened first, and pending invitations; Open opens the project on the map', async () => {
    const { store, root, navigate, open } = app();
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } });
    await store.openProjectFolder('example-org/sample-project-1');

    await open();

    const projects = cardTitled(root, 'Your projects');
    expect(texts(projects.querySelectorAll('.rows .strong'))).toEqual(['sample-project-1']);
    expect(text(projects.querySelector('.rows .small'))).toBe('example-org/sample-project-1 · opened 2026-10-22');
    const invitations = cardTitled(root, 'Pending invitations');
    expect(text(invitations.querySelector('.rows .small'))).toBe('example-org/kickoff-notes · invited by ben-example on 2026-10-20');

    click(projects, 'Open');
    await until(() => navigate.mock.calls.length > 0, 'the map to open');
    expect(navigate).toHaveBeenCalledWith('map', { project: 'example-org/sample-project-1' });
  });

  it('flags a project the store could not read with the reason, and lists every other project as usual', async () => {
    const { store, root, open } = app();
    for (const name of ['sample-project-1', 'sample-project-3']) {
      await store.createProject({ newRepository: { organisation: 'example-org', name } });
      await store.openProjectFolder(`example-org/${name}`);
    }
    const reason = '.grillo/members.json is not in the format Grillo writes: not JSON';
    const listed = await store.listProjects();
    vi.spyOn(store, 'listProjects').mockResolvedValue(listed.map((project) => (project.name === 'sample-project-3' ? { ...project, damaged: reason } : project)));

    await open();

    const rows = [...cardTitled(root, 'Your projects').querySelectorAll('.rows li')];
    expect(rows.map((row) => texts(row.querySelectorAll('.badge')))).toEqual([['Damaged'], []]);
    expect(text(rows[0].querySelector('.reason'))).toBe(`${reason}. Fix the file on GitHub, then open the project again.`);
    expect(rows[1].querySelector('.reason')).toBeNull();
    expect(buttonNamed(rows[0], 'Open')?.disabled).toBe(false);
  });

  it('accepts an invitation in one click, pre-fills role and domains from the last project joined, and saves them', async () => {
    const { store, settings, root, navigate, open } = app();
    // The invited repository's project, as its admin created it.
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'kickoff-notes' } });
    settings.set(LAST_MEMBERSHIP_KEY, { project: 'example-org/sample-project-1', role: 'Sample role A', domains: ['product'] });
    await open();

    click(cardTitled(root, 'Pending invitations'), 'Accept');
    await until(() => text(root.querySelector('h3')) === 'You joined kickoff-notes', 'the invitee state');

    expect(await store.listPendingInvitations()).toEqual([]);
    expect(text(root.querySelector('.badge.ok'))).toBe('Invite accepted');
    expect(root.querySelector<HTMLInputElement>('.field input')?.value).toBe('Sample role A');
    expect(texts(root.querySelectorAll('.tag'))).toEqual(['product×']);
    expect(root.textContent).toContain('Pre-filled from the last project you joined, example-org/sample-project-1.');

    type(root, 'input[aria-label="Add a domain"]', 'platform');
    click(root, 'Add domain');
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Add a domain"]')?.value).toBe('');
    click(root, 'Save and open the project');
    await until(() => navigate.mock.calls.length > 0, 'the project to open');

    expect(await store.getMember('example-org/kickoff-notes', 'ada-example')).toMatchObject({
      role: 'Sample role A',
      domains: ['product', 'platform'],
    });
    expect(settings.get(LAST_MEMBERSHIP_KEY, null)).toEqual({
      project: 'example-org/kickoff-notes',
      role: 'Sample role A',
      domains: ['product', 'platform'],
    });
    expect(navigate).toHaveBeenCalledWith('map', { project: 'example-org/kickoff-notes' });
  });
});

describe('project creation: a new repository', () => {
  it('creates the repository with the edited structure, invites, saves the idea as S1 and starts /grillo-wayfinder', async () => {
    const { store, settings, starts, root, navigate, open } = app();
    await open();
    click(root, 'New project');
    await until(() => onWhere(root), 'the form');
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });

    type(root, 'input[aria-label="Project name"]', 'Sample project 1');
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Repository name"]')?.value).toBe('sample-project-1');
    walkTo(root, 'Structure');
    const structure = stepCard(root);
    expect(sectionNames(structure)).toEqual(DEFAULT_PRD_STRUCTURE.sections.map((section) => section.name));
    click(structure, 'Add section');
    const names = root.querySelectorAll<HTMLInputElement>('input[aria-label="Section name"]');
    type(names[names.length - 1].parentElement as HTMLElement, 'input[aria-label="Section name"]', 'Sample added section');
    root.querySelectorAll<HTMLButtonElement>('button[aria-label="Move down"]')[0].click();
    click(stepCard(root).querySelectorAll('.rows > li')[12], 'Remove');
    walkTo(root, 'People');
    type(root, 'input[aria-label="GitHub login to invite"]', 'ben-example');
    click(root, 'Invite');
    type(stepCard(root), '.field input', 'Sample role A');
    type(root, 'input[aria-label="Add a domain"]', 'product');
    click(root, 'Add domain');
    walkTo(root, 'Idea');
    type(root, 'textarea[aria-label="The idea"]', IDEA);
    walkTo(root, 'Review');

    click(root, 'Create project');
    await until(() => starts.length === 1, 'the grilling agent to start');

    const project = 'example-org/sample-project-1';
    const sections = (await store.getStructure(project)).sections.map((section) => section.name);
    expect(sections.slice(0, 2)).toEqual(['Users and roles', 'Problem']);
    expect(sections).not.toContain('Assumptions');
    expect(sections.at(-1)).toBe('Sample added section');
    expect((await store.listMembers(project)).map(({ login, role, domains }) => ({ login, role, domains }))).toEqual([
      { login: 'ada-example', role: 'Sample role A', domains: ['product'] },
      { login: 'ben-example', role: '', domains: [] },
    ]);
    expect(await store.listSources(project)).toEqual([
      { code: 'S1', kind: 'pasted-text', who: 'Ada Example', when: NOW.toISOString(), where: 'the idea, given when the project was created', text: IDEA },
    ]);
    expect(starts).toEqual([
      {
        kind: 'grilling',
        folder: '/memory/Grillo/example-org/sample-project-1',
        firstMessage: '/grillo-wayfinder .grillo/sources/S1.md',
        title: 'Grilling · Sample project 1',
      },
    ]);
    expect(settings.get(LAST_MEMBERSHIP_KEY, null)).toEqual({ project, role: 'Sample role A', domains: ['product'] });

    await until(() => buttonNamed(root, 'Open the grilling agent') !== undefined, 'the creating state to finish');
    expect(texts(root.querySelectorAll('.rows.card > li'))).toEqual([
      "Private repository example-org/sample-project-1 created, with Grillo's labels and folderDone",
      'Your role and domains savedDone',
      'Invites sent to ben-exampleDone',
      'The idea saved as source S1Done',
      'Grilling agent started; it is building the map and ticketsWorking…',
    ]);
    click(root, 'Open the grilling agent');
    expect(navigate).toHaveBeenLastCalledWith('agent-tab', { agentId: 'agent-1' });
  });

  it('pre-fills role and domains from the last project joined, and starts from an earlier project\'s structure on request', async () => {
    const { store, settings, root, open } = app();
    await store.createProject({
      newRepository: { organisation: 'example-org', name: 'sample-project-0' },
      structure: { sections: [{ name: 'Sample section 1', note: 'Note 1' }] },
    });
    settings.set(LAST_MEMBERSHIP_KEY, { project: 'example-org/sample-project-0', role: 'Sample role A', domains: ['product'] });
    await open();
    click(root, 'New project');
    await until(() => onWhere(root), 'the form');
    type(root, REPOSITORY_NAME, 'sample-project-1');
    walkTo(root, 'People');

    const members = stepCard(root);
    expect(members.querySelector<HTMLInputElement>('.field input')?.value).toBe('Sample role A');
    expect(texts(members.querySelectorAll('.tag'))).toEqual(['product×']);
    expect(text(members)).toContain('Pre-filled from the last project you joined, example-org/sample-project-0.');

    click(root, 'Back');
    const from = stepCard(root).querySelector('select') as HTMLSelectElement;
    expect(texts(from.options)).toEqual(['Grillo default', 'sample-project-0 (an earlier project of yours)']);
    from.value = 'example-org/sample-project-0';
    from.dispatchEvent(new Event('change'));
    expect(sectionNames(root)).toEqual(['Sample section 1']);
  });

  it.each([
    [
      'no idea',
      (root: HTMLElement) => {
        type(root, 'input[aria-label="Repository name"]', 'sample-project-1');
        walkTo(root, 'Idea');
      },
      'Give the idea',
    ],
    [
      'two sections with one name',
      (root: HTMLElement) => {
        type(root, 'input[aria-label="Repository name"]', 'sample-project-1');
        walkTo(root, 'Structure');
        type(root.querySelectorAll('.rows.structure > li')[1], 'input[aria-label="Section name"]', 'Problem');
      },
      'Two sections are both called "Problem"',
    ],
  ])('refuses to create a project with %s, saying why, and creates nothing', async (_case, fill, message) => {
    const { store, starts, root, open } = app();
    await open();
    click(root, 'New project');
    await until(() => onWhere(root), 'the form');

    fill(root);
    click(root, 'Next');
    await flush();

    expect(text(root.querySelector('.note.err'))).toContain(message);
    expect(await store.listProjects()).toEqual([]);
    expect(starts).toEqual([]);
  });

  it('shows a failed step with its reason, and Try again resumes there without saving the idea twice', async () => {
    const { store, starts, root, open } = app({ failAgentStarts: 1 });
    await open();
    click(root, 'New project');
    await until(() => onWhere(root), 'the form');
    fillNewProject(root);

    click(root, 'Create project');
    await until(() => buttonNamed(root, 'Try again') !== undefined, 'the failed step');
    expect(text(root.querySelector('.rows.card > li:last-child .badge'))).toBe('Failed');
    expect(text(root.querySelector('.note.err'))).toBe('Claude Code is not installed on this laptop');

    click(root, 'Try again');
    await until(() => starts.length === 1, 'the grilling agent to start');
    expect((await store.listSources('example-org/sample-project-1')).map((source) => source.code)).toEqual(['S1']);
  });
  it('carries on past an invite GitHub refuses, naming who was not invited and why, then saves S1 and starts the agent', async () => {
    const { store, starts, root, open } = app({ noIdentity: true });
    await open();
    click(root, 'New project');
    await until(() => onWhere(root), 'the form');
    type(root, 'input[aria-label="Repository name"]', 'sample-project-1');
    walkTo(root, 'People');
    // Your own login: with no identity the form cannot catch it, and the store refuses it as a member already.
    for (const login of ['ada-example', 'ben-example']) {
      type(root, 'input[aria-label="GitHub login to invite"]', login);
      click(root, 'Invite');
    }
    walkTo(root, 'Idea');
    type(root, 'textarea[aria-label="The idea"]', IDEA);
    walkTo(root, 'Review');

    click(root, 'Create project');
    await until(() => starts.length === 1, 'the grilling agent to start');

    const invites = [...root.querySelectorAll('.rows.card > li')][2];
    expect(text(invites.querySelector('.row'))).toBe('Invites sent to ben-example');
    expect(text(invites.querySelector('.badge'))).toBe('Partly done');
    expect(text(invites.querySelector('p'))).toBe(
      'Not invited (invite them later from the project): ada-example: ada-example is already a member of example-org/sample-project-1.',
    );
    expect((await store.listMembers('example-org/sample-project-1')).map((member) => member.login)).toEqual(['ada-example', 'ben-example']);
    expect((await store.listSources('example-org/sample-project-1')).map((source) => source.code)).toEqual(['S1']);
    expect(starts[0]).toMatchObject({ firstMessage: '/grillo-wayfinder .grillo/sources/S1.md' });
    expect(buttonNamed(root, 'Try again')).toBeUndefined();
  });
});

describe('project creation: connecting an existing repository', () => {
  async function connectForm(context: ReturnType<typeof app>, repository: string) {
    await context.open();
    click(context.root, 'Connect existing');
    await until(() => onWhere(context.root), 'the form');
    type(context.root, 'input[aria-label="Search repositories"]', repository);
  }

  it('greys out inviting with the reason, folds the structure, and starts the agent on a pasted transcript', async () => {
    const context = app();
    const { store, starts, root } = context;
    await connectForm(context, 'example-org/team-code');

    click(root, 'Check access');
    await until(() => root.querySelector('.badge.warn') !== null, 'the access check');
    walkTo(root, 'Structure');
    expect(text(stepCard(root))).toContain('Grillo default · 13 sections');
    walkTo(root, 'People');
    const members = stepCard(root);
    expect(members.querySelector<HTMLInputElement>('input[aria-label="GitHub login to invite"]')?.disabled).toBe(true);
    expect(buttonNamed(members, 'Invite')?.disabled).toBe(true);
    expect(text(members.querySelector('.reason'))).toContain('Inviting needs admin rights on example-org/team-code');

    walkTo(root, 'Idea');
    click(root, 'Paste or upload a transcript');
    type(root, 'textarea[aria-label="Transcript"]', 'Sample transcript line 1: a made-up kick-off remark.');
    walkTo(root, 'Review');
    click(root, 'Connect and start');
    await until(() => starts.length === 1, 'the grilling agent to start');

    expect((await store.listSources('example-org/team-code'))[0]).toMatchObject({
      code: 'S1',
      kind: 'meeting',
      where: 'a transcript, given when the project was created',
      text: 'Sample transcript line 1: a made-up kick-off remark.',
    });
    expect(starts[0]).toMatchObject({ firstMessage: '/grillo-wayfinder .grillo/sources/S1.md', title: 'Grilling · example-org/team-code' });
  });

  it('offers to open a repository that already holds a Grillo project instead of starting a second one', async () => {
    const context = app();
    const { store, starts, root, navigate } = context;
    await store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' } });
    await connectForm(context, 'example-org/team-code');
    fillConnection(root);

    click(root, 'Connect and start');
    await until(() => buttonNamed(root, 'Open it') !== undefined, 'the repository problem');

    expect(text(root.querySelector('.rows .badge.info'))).toBe('Already holds a Grillo project');
    expect(await store.listSources('example-org/team-code')).toEqual([]);
    click(root, 'Open it');
    await until(() => navigate.mock.calls.length > 0, 'the project to open');
    expect(navigate).toHaveBeenCalledWith('map', { project: 'example-org/team-code' });
    expect(starts).toEqual([]);
  });

  it('shows why a repository cannot be connected, with Check again', async () => {
    const context = app({
      seed: {
        repositories: [
          { repository: { owner: 'example-org', name: 'sample-repo-4' }, permission: 'admin', issuesEnabled: false },
        ],
      },
    });
    const { root } = context;
    await connectForm(context, 'example-org/sample-repo-4');
    fillConnection(root);

    click(root, 'Connect and start');
    await until(() => root.querySelector('.badge.err') !== null, 'the repository problem');

    expect(text(root.querySelector('.badge.err'))).toBe('Cannot connect');
    expect(text(root.querySelector('.rows p'))).toContain('Issues are turned off in example-org/sample-repo-4');
    click(root, 'Check again');
    await until(() => onWhere(root) && buttonNamed(root, 'Next')?.disabled === false, 'the form again');
    walkTo(root, 'Idea');
    expect(root.querySelector<HTMLTextAreaElement>('textarea[aria-label="The idea"]')?.value).toBe(IDEA);
  });
});

describe('project creation: the repository list', () => {
  const seed: MemoryStoreOptions['seed'] = {
    repositories: [
      { repository: { owner: 'example-org', name: 'sample-repo-1' }, permission: 'write', issuesEnabled: true },
      { repository: { owner: 'example-org', name: 'sample-repo-2' }, permission: 'admin', issuesEnabled: true },
      { repository: { owner: 'example-org', name: 'other-repo' }, permission: 'read', issuesEnabled: true },
    ],
  };
  const repositoryRows = (root: HTMLElement) => [...stepCard(root).querySelectorAll('.rows > li')];
  const radio = (root: HTMLElement, label: string) =>
    repositoryRows(root).find((row) => text(row.querySelector('label')) === label)?.querySelector<HTMLInputElement>('input[type="radio"]');

  async function listed(context: ReturnType<typeof app>) {
    await context.open();
    click(context.root, 'New project');
    await until(() => onWhere(context.root), 'the form');
    click(context.root, 'Connect an existing one');
  }

  it('lists the member\'s repositories with their access, narrows them as you search, and keeps the search box focused', async () => {
    const context = app({ seed });
    const { root } = context;
    await listed(context);

    expect(repositoryRows(root).map((row) => [text(row.querySelector('label')), text(row.querySelector('.badge'))])).toEqual([
      ['example-org/other-repo', 'Read access only'],
      ['example-org/sample-repo-1', 'Write access'],
      ['example-org/sample-repo-2', 'Admin access'],
    ]);

    type(root, 'input[aria-label="Search repositories"]', 'SAMPLE');

    expect(repositoryRows(root).map((row) => text(row.querySelector('label')))).toEqual(['example-org/sample-repo-1', 'example-org/sample-repo-2']);
    expect(document.activeElement).toBe(root.querySelector('input[aria-label="Search repositories"]'));

    type(root, 'input[aria-label="Search repositories"]', 'no-such-thing');
    expect(repositoryRows(root)).toEqual([]);
    expect(text(stepCard(root))).toContain('No repository of yours matches this search.');
  });

  it('picking a repository selects it with no Check access: an admin may invite, and connecting uses that repository', async () => {
    const context = app({ seed });
    const { store, starts, root } = context;
    await listed(context);

    (radio(root, 'example-org/sample-repo-2') as HTMLInputElement).click();

    expect(radio(root, 'example-org/sample-repo-2')?.checked).toBe(true);
    expect(radio(root, 'example-org/sample-repo-1')?.checked).toBe(false);
    expect(repositoryRows(root)[2].classList.contains('selected')).toBe(true);
    walkTo(root, 'People');
    expect(root.querySelector<HTMLInputElement>('input[aria-label="GitHub login to invite"]')?.disabled).toBe(false);

    fillConnection(root);
    click(root, 'Connect and start');
    await until(() => starts.length === 1, 'the grilling agent to start');
    expect((await store.getProject('example-org/sample-repo-2')).id).toBe('example-org/sample-repo-2');
  });

  it('Check access says Checking… on the picked row, then Access not known with the reason when GitHub gives no answer', async () => {
    const context = app({ seed });
    const { store, root } = context;
    await listed(context);
    (radio(root, 'example-org/sample-repo-1') as HTMLInputElement).click();
    let refuse: (reason: Error) => void = () => undefined;
    vi.spyOn(store, 'viewerPermission').mockReturnValue(new Promise((_resolve, reject) => (refuse = reject)));

    click(root, 'Check access');
    await until(() => text(repositoryRows(root)[1].querySelector('.badge')) === 'Checking…', 'the check to run');
    expect(buttonNamed(root, 'Check access')?.disabled).toBe(true);
    expect(radio(root, 'example-org/sample-repo-1')?.disabled).toBe(true);

    refuse(new Error('GitHub did not answer'));
    await until(() => text(repositoryRows(root)[1].querySelector('.badge')) === 'Access not known', 'the check to end');
    expect(text(repositoryRows(root)[1].querySelector('p'))).toBe('GitHub did not answer');
    expect(radio(root, 'example-org/sample-repo-1')?.checked).toBe(true);
    walkTo(root, 'People');
    expect(text(stepCard(root).querySelector('.reason'))).toContain('Grillo has not confirmed your access yet');
  });

  it.each([
    ['picking a row', (root: HTMLElement) => (radio(root, 'example-org/sample-repo-1') as HTMLInputElement).click()],
    ['typing a repository in full', (root: HTMLElement) => type(root, 'input[aria-label="Search repositories"]', 'example-org/sample-repo-1')],
  ])('takes the "pick a repository" note away on %s', async (_case, choose) => {
    const context = app({ seed });
    const { root } = context;
    await listed(context);
    click(root, 'Check access');
    await flush();
    expect(text(root.querySelector('.note.err'))).toContain('Pick the repository to connect');

    choose(root);

    expect(root.querySelector('.note.err')).toBeNull();
  });

  it('keeps the picked repository while a search hides it, and says it cannot be connected when read access is all there is', async () => {
    const context = app({ seed });
    const { root } = context;
    await listed(context);

    (radio(root, 'example-org/other-repo') as HTMLInputElement).click();
    expect(text(repositoryRows(root)[0])).toContain('Connecting needs write access.');

    type(root, 'input[aria-label="Search repositories"]', 'sample');
    expect(repositoryRows(root).map((row) => text(row.querySelector('.strong')))).toContain('example-org/other-repo');
    walkTo(root, 'People');
    expect(text(stepCard(root))).toContain('Inviting needs admin rights on example-org/other-repo');
  });

  it('checks a repository typed in full that the list does not hold, and drops it when the typing no longer names one', async () => {
    const context = app({ seed });
    const { root } = context;
    await listed(context);
    vi.spyOn(context.store, 'viewerPermission').mockResolvedValue('admin');

    type(root, 'input[aria-label="Search repositories"]', 'example-org/not-listed');
    click(root, 'Check access');
    await until(() => root.querySelector('.rows .badge.ok') !== null, 'the access check');
    expect(text(repositoryRows(root)[0])).toBe('example-org/not-listedAdmin access');

    type(root, 'input[aria-label="Search repositories"]', 'example-org/');
    expect(repositoryRows(root).map((row) => text(row.querySelector('.strong')))).not.toContain('example-org/not-listed');
    click(root, 'Next');
    await flush();
    expect(text(root.querySelector('.note.err'))).toContain('Pick the repository to connect');
  });

  it('says so when the list cannot be read, and a repository can still be typed in full', async () => {
    const context = app({ seed });
    const { store, root } = context;
    vi.spyOn(store, 'listRepositories').mockRejectedValue(new Error('gh is signed out'));
    await listed(context);

    expect(text(stepCard(root).querySelector('.note.warn'))).toBe(
      'Grillo could not list your repositories: gh is signed out. Type the repository in full as owner/repository instead.',
    );

    type(root, 'input[aria-label="Search repositories"]', 'example-org/sample-repo-1');
    click(root, 'Check access');
    await until(() => root.querySelector('.rows .badge.warn') !== null, 'the access check');
    expect(text(root.querySelector('.rows .badge.warn'))).toBe('Write access');
  });

  it('ignores list entries it cannot read, and asks for a repository when Check access has none to check', async () => {
    const context = app({ seed });
    const { store, root } = context;
    vi.spyOn(store, 'listRepositories').mockResolvedValue([
      null,
      { repository: null, permission: 'write' },
      { repository: { owner: 'example-org', name: 'sample-repo-1' }, permission: 'owner' },
      { repository: { owner: 'example-org', name: 'sample-repo-2' }, permission: 'admin' },
    ] as never);
    await listed(context);

    expect(repositoryRows(root).map((row) => text(row.querySelector('label')))).toEqual(['example-org/sample-repo-2']);

    click(root, 'Check access');
    await flush();
    expect(text(root.querySelector('.note.err'))).toContain('Pick the repository to connect');
  });
});

describe('project creation: the demo path in the in-memory store', () => {
  it('Check access on the seeded repository shows its real access level', async () => {
    const context = app();
    const { root } = context;
    await context.open();
    click(root, 'New project');
    await until(() => onWhere(root), 'the form');
    click(root, 'Connect an existing one');

    type(root, 'input[aria-label="Search repositories"]', 'example-org/team-code');
    click(root, 'Check access');
    await flush();
    await until(() => root.querySelector('.rows > li.selected') !== null, 'the access check');

    expect(text(root.querySelector('.rows > li.selected .badge'))).toBe('Write access');
    expect(root.textContent).not.toContain('Access not known');
  });

  it('accepting the seeded invitation, with no project made by hand first, saves and opens the project', async () => {
    const { store, root, navigate, open } = app();
    await open();

    click(cardTitled(root, 'Pending invitations'), 'Accept');
    await until(() => text(root.querySelector('h3')) === 'You joined kickoff-notes', 'the invitee state');
    click(root, 'Save and open the project');
    await until(() => navigate.mock.calls.length > 0, 'the project to open');

    expect(navigate).toHaveBeenCalledWith('map', { project: 'example-org/kickoff-notes' });
    expect((await store.listRecentProjects()).map(({ project }) => project)).toEqual(['example-org/kickoff-notes']);
  });
});

describe('project creation: starting the grilling agent again', () => {
  const PROJECT = 'example-org/sample-project-1';

  /** The form filled in and created, with the first start of the agent refused. */
  async function refusedStart(context: ReturnType<typeof app>) {
    const { root } = context;
    await context.open();
    click(root, 'New project');
    await until(() => onWhere(root), 'the form');
    type(root, 'input[aria-label="Project name"]', 'Sample project 1');
    walkTo(root, 'Idea');
    type(root, 'textarea[aria-label="The idea"]', IDEA);
    walkTo(root, 'Review');
    click(root, 'Create project');
    await until(() => buttonNamed(root, 'Try again') !== undefined, 'the failed step');
  }

  /** Leaves the screen, as a member going to another tab does, and comes back to Your projects. */
  async function leaveAndComeBack(context: ReturnType<typeof app>) {
    context.root.replaceChildren();
    await context.open();
  }

  it('opening the project later shows the failed start with its reason, and Try again starts the same agent once', async () => {
    const context = app({ failAgentStarts: 1 });
    const { root, starts, navigate, store } = context;
    await refusedStart(context);

    await leaveAndComeBack(context);
    click(cardTitled(root, 'Your projects'), 'Open');
    await until(() => buttonNamed(root, 'Try again') !== undefined, 'the failed step again');

    expect(navigate).not.toHaveBeenCalled();
    expect(texts(root.querySelectorAll('.rows.card > li'))).toEqual(['Grilling agent started; it is building the map and ticketsFailed']);
    expect(text(root.querySelector('.note.err'))).toBe('Claude Code is not installed on this laptop');

    click(root, 'Try again');
    await until(() => starts.length === 1, 'the grilling agent to start');
    expect(starts[0]).toEqual({
      kind: 'grilling',
      folder: '/memory/Grillo/example-org/sample-project-1',
      firstMessage: '/grillo-wayfinder .grillo/sources/S1.md',
      title: 'Grilling · Sample project 1',
    });
    expect((await store.listSources(PROJECT)).map((source) => source.code)).toEqual(['S1']);

    await until(() => buttonNamed(root, 'Open the grilling agent') !== undefined, 'the agent to be started');
    click(root, 'Open the grilling agent');
    expect(navigate).toHaveBeenLastCalledWith('agent-tab', { agentId: 'agent-1' });

    await leaveAndComeBack(context);
    click(cardTitled(root, 'Your projects'), 'Open');
    await until(() => navigate.mock.calls.some(([screenId]) => screenId === 'map'), 'the map, the agent being started now');
    expect(starts).toHaveLength(1);
  });

  it('remembers a start refused after the member left the screen, while the run was still going', async () => {
    const context = app({ failAgentStarts: 1 });
    const { root, settings } = context;
    await context.open();
    click(root, 'New project');
    await until(() => onWhere(root), 'the form');
    fillNewProject(root);

    click(root, 'Create project');
    root.replaceChildren();
    await until(() => JSON.stringify(settings.get(UNSTARTED_AGENTS_KEY, [])).includes(PROJECT), 'the refused start to be kept');

    await context.open();
    click(cardTitled(root, 'Your projects'), 'Open');
    await until(() => buttonNamed(root, 'Try again') !== undefined, 'the failed step');
  });

  it('lists a project whose folder could not be opened, and from the failed start Open the map still leaves', async () => {
    const context = app();
    const { store, root, navigate } = context;
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    vi.spyOn(store, 'openProjectFolder').mockRejectedValueOnce(new Error('git could not clone the repository'));
    await refusedStart(context);
    expect(text(root.querySelector('.note.err'))).toBe('git could not clone the repository');

    await leaveAndComeBack(context);
    const projects = cardTitled(root, 'Your projects');
    expect(text(projects.querySelector('.rows .small'))).toBe(`${PROJECT} · created 2026-10-22`);
    click(projects, 'Open');
    await until(() => buttonNamed(root, 'Open the map') !== undefined, 'the failed step');

    click(root, 'Open the map');
    expect(navigate).toHaveBeenCalledWith('map', { project: PROJECT });
  });

  it('keeps the date of the first refusal as the created date, however many later tries are refused', async () => {
    const context = app();
    const { store, root } = context;
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    vi.spyOn(store, 'openProjectFolder').mockRejectedValue(new Error('git could not clone the repository'));
    await refusedStart(context);

    vi.setSystemTime(new Date('2026-11-05T10:00:00.000Z'));
    click(root, 'Try again');
    await flush();
    await until(() => buttonNamed(root, 'Try again')?.disabled === false, 'the second refusal');

    await leaveAndComeBack(context);
    expect(text(cardTitled(root, 'Your projects').querySelector('.rows .small'))).toBe(`${PROJECT} · created 2026-10-22`);
  });

  it('goes straight to the map, starting nothing, when the project has a map by now', async () => {
    const context = app({ failAgentStarts: 1 });
    const { store, root, starts, navigate, settings } = context;
    await refusedStart(context);
    await store.createMap(PROJECT, { destination: 'A PRD', notes: '', fog: [], outOfScope: [] });

    await leaveAndComeBack(context);
    click(cardTitled(root, 'Your projects'), 'Open');
    await until(() => navigate.mock.calls.length > 0, 'the map');

    expect(navigate).toHaveBeenCalledWith('map', { project: PROJECT });
    expect(starts).toEqual([]);
    expect(settings.get(UNSTARTED_AGENTS_KEY, [])).toEqual([]);
  });

  it.each([
    ['text', 'not a list'],
    ['a null entry and a half record', [null, { project: PROJECT }]],
  ])('treats a settings file holding %s as no refused start', async (_case, value) => {
    const context = app();
    const { store, root, navigate, settings } = context;
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } });
    await store.openProjectFolder(PROJECT);
    settings.set(UNSTARTED_AGENTS_KEY, value as never);

    await context.open();
    click(cardTitled(root, 'Your projects'), 'Open');
    await until(() => navigate.mock.calls.length > 0, 'the map');

    expect(navigate).toHaveBeenCalledWith('map', { project: PROJECT });
  });
});

describe('project creation: editing the structure of an existing project', () => {
  it('opens on the project\'s structure, saves the edits to structure.json and starts /grillo-prd regenerate', async () => {
    const { store, starts, root, navigate, open } = app();
    const project = 'example-org/sample-project-1';
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } });

    // Exactly what the PRD view's "Edit structure and regenerate" navigates with.
    await open({ project, view: 'structure' });
    expect(sectionNames(root)).toEqual(DEFAULT_PRD_STRUCTURE.sections.map((section) => section.name));
    click(root, 'Add section');
    const names = root.querySelectorAll<HTMLInputElement>('input[aria-label="Section name"]');
    type(names[names.length - 1].parentElement as HTMLElement, 'input[aria-label="Section name"]', 'Sample added section');
    click(root, 'Save and regenerate');
    await until(() => navigate.mock.calls.length > 0, 'the PRD view');

    expect((await store.getStructure(project)).sections.at(-1)).toEqual({ name: 'Sample added section', note: '' });
    expect(starts).toEqual([
      { kind: 'grilling', folder: '/memory/Grillo/example-org/sample-project-1', firstMessage: '/grillo-prd regenerate', title: 'Grilling · PRD' },
    ]);
    expect(navigate).toHaveBeenCalledWith('prd', { project });
  });

  it('keeps an unsaveable structure on screen with the reason, and Cancel goes back to the PRD view unsaved', async () => {
    const { store, starts, root, navigate, open } = app();
    const project = 'example-org/sample-project-1';
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } });
    await open({ project });

    type(root.querySelectorAll('.rows.structure > li')[0], 'input[aria-label="Section name"]', ' ');
    click(root, 'Save and regenerate');
    await flush();
    expect(text(root.querySelector('.note.err'))).toBe('Every section needs a name.');

    click(root, 'Cancel');
    expect(navigate).toHaveBeenCalledWith('prd', { project });
    expect(await store.getStructure(project)).toEqual(DEFAULT_PRD_STRUCTURE);
    expect(starts).toEqual([]);
  });
});

describe('project creation: registration', () => {
  it('registers as the screen the Project tab opens', () => {
    expect(APP_TABS.find((tab) => tab.label === 'Project')?.screenId).toBe(screen.id);
  });
});

describe('project creation: the owner of a new repository', () => {
  const PUBLIC_WARNING = 'Public means anyone on the internet can read this project: its transcripts, answers and PRD. Comments from people who are not collaborators are never treated as answers.';

  async function formOf(options: AppOptions = {}) {
    const context = app(options);
    await context.open();
    click(context.root, 'New project');
    await until(() => onWhere(context.root), 'the form');
    const card = () => stepCard(context.root);
    const owner = () => card().querySelector('select') as HTMLSelectElement;
    const pick = (login: string) => {
      owner().value = login;
      owner().dispatchEvent(new Event('change'));
    };
    const fill = () => {
      type(context.root, 'input[aria-label="Project name"]', 'Sample project 1');
    };
    /** From Where, once the owner is settled: gives the idea and stops on the review page. */
    const finish = () => {
      walkTo(context.root, 'Idea');
      type(context.root, 'textarea[aria-label="The idea"]', IDEA);
      walkTo(context.root, 'Review');
    };
    return { ...context, card, owner, pick, fill, finish };
  }

  const visibility = (card: HTMLElement) => card.querySelector('[aria-label="Visibility"]');
  const NO_ORGANISATION = { organisations: [] };

  it('words the field Owner and lists the organisations and the own account, an organisation first', async () => {
    const { card, owner } = await formOf({ seed: { organisations: [{ login: 'example-org', name: null }, { login: 'example-org-2', name: null }] } });

    expect(texts(card().querySelectorAll('label.field')).find((label) => label.startsWith('Owner'))).toBeDefined();
    expect(texts(owner().options)).toEqual(['example-org', 'example-org-2', 'ada-example (your account)']);
    expect(owner().value).toBe('example-org');
    expect(visibility(card())).toBeNull();
    expect(text(card())).toContain('Every member becomes a repository admin.');
  });

  it('preselects the own account with no organisation, Private by default, and finishes the form', async () => {
    const { store, starts, root, card, owner, fill, finish } = await formOf({ seed: NO_ORGANISATION });

    expect(owner().value).toBe('ada-example');
    expect(owner().disabled).toBe(false);
    expect(texts(card().querySelectorAll('[aria-label="Visibility"] button[aria-pressed="true"]'))).toEqual(['Private']);
    expect(text(card())).toContain('A private repository under your own GitHub account. Only you can invite people, close and reopen the project');
    expect(text(card())).not.toContain('Every member becomes a repository admin.');
    fill();
    finish();

    click(root, 'Create project');
    await until(() => starts.length === 1, 'the grilling agent to start');

    expect(await store.viewerPermission('ada-example/sample-project-1')).toBe('admin');
    expect(text(root.querySelector('.rows.card > li'))).toContain('Private repository ada-example/sample-project-1 created');
  });

  it('shows the warning only on Public, says public on the Creating row and creates it public', async () => {
    const { store, starts, root, card, pick, fill, finish } = await formOf();
    const created = vi.spyOn(store, 'createProject');
    pick('ada-example');
    fill();
    expect(text(card())).not.toContain(PUBLIC_WARNING);

    click(visibility(card()) as HTMLElement, 'Public');
    const warning = card().querySelector('.note.warn');
    expect(text(warning)).toBe(PUBLIC_WARNING);
    expect(text(card())).toContain('A public repository under your own GitHub account.');

    click(visibility(card()) as HTMLElement, 'Private');
    expect(card().querySelector('.note.warn')).toBeNull();
    click(visibility(card()) as HTMLElement, 'Public');
    finish();

    click(root, 'Create project');
    await until(() => starts.length === 1, 'the grilling agent to start');

    expect(created.mock.calls[0][0]).toMatchObject({ newRepository: { organisation: 'ada-example', name: 'sample-project-1', visibility: 'public' } });
    expect(text(root.querySelector('.rows.card > li'))).toContain('Public repository ada-example/sample-project-1 created');
  });

  it('takes the choice away and goes back to Private on moving to an organisation', async () => {
    const { store, starts, root, card, pick, fill, finish } = await formOf();
    const created = vi.spyOn(store, 'createProject');
    pick('ada-example');
    click(visibility(card()) as HTMLElement, 'Public');
    pick('example-org');
    fill();

    expect(visibility(card())).toBeNull();
    expect(card().querySelector('.note.warn')).toBeNull();
    pick('ada-example');
    expect(texts(card().querySelectorAll('[aria-label="Visibility"] button[aria-pressed="true"]'))).toEqual(['Private']);
    pick('example-org');
    finish();

    click(root, 'Create project');
    await until(() => starts.length === 1, 'the grilling agent to start');

    expect(created.mock.calls[0][0]).toEqual(expect.objectContaining({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } }));
  });

  it('keeps what was typed when the owner changes', async () => {
    const { root, pick, fill } = await formOf();
    fill();
    walkTo(root, 'Idea');
    type(root, THE_IDEA, IDEA);
    click(root, 'Back');
    click(root, 'Back');
    click(root, 'Back');

    pick('ada-example');

    expect(root.querySelector<HTMLInputElement>('input[aria-label="Project name"]')?.value).toBe('Sample project 1');
    walkTo(root, 'Idea');
    expect(root.querySelector<HTMLTextAreaElement>('textarea[aria-label="The idea"]')?.value).toBe(IDEA);
  });

  it('says so when neither an organisation nor the own account can be read, and asks for an owner', async () => {
    const context = app({ seed: NO_ORGANISATION });
    vi.spyOn(context.store, 'signedInLogin').mockRejectedValue(new Error('gh is signed out'));
    await context.open();
    click(context.root, 'New project');
    await until(() => onWhere(context.root), 'the form');

    const card = stepCard(context.root);
    expect((card.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
    expect(context.root.textContent).toContain('Grillo could not read your GitHub account: gh is signed out');
    expect(text(card)).toContain('Grillo cannot create a repository without an owner. Connect an existing one instead.');
    type(context.root, 'input[aria-label="Repository name"]', 'sample-project-1');

    click(context.root, 'Next');

    expect(context.root.textContent).toContain('Pick the owner of the new repository.');
    expect(await context.store.listProjects()).toEqual([]);
  });

  it('still offers the organisations when the own account cannot be read', async () => {
    const context = app();
    vi.spyOn(context.store, 'signedInLogin').mockRejectedValue(new Error('gh is signed out'));
    await context.open();
    click(context.root, 'New project');
    await until(() => onWhere(context.root), 'the form');

    const select = stepCard(context.root).querySelector('select') as HTMLSelectElement;
    expect(texts(select.options)).toEqual(['example-org']);
    expect(select.value).toBe('example-org');
  });
});

describe('project creation: the guided steps', () => {
  const WAYS_IN = [
    ['New project', 'Create project'],
    ['Connect existing', 'Connect and start'],
  ] as const;

  /** Opens the screen and takes a way in; on Connect existing a repository is chosen, so Where can be left. */
  async function wayIn(way: (typeof WAYS_IN)[number][0], options: AppOptions = {}) {
    const context = app(options);
    await context.open();
    click(context.root, way);
    await until(() => onWhere(context.root), 'the first step');
    if (way === 'New project') type(context.root, PROJECT_NAME, 'Sample project 1');
    else type(context.root, SEARCH, 'example-org/team-docs');
    return context;
  }

  it('shows New project and Connect existing on the start page, with or without projects, each opening its own Where', async () => {
    const { root, open } = app();
    await open();

    click(root, 'Connect existing');
    await until(() => onWhere(root), 'the first step');
    expect(root.querySelector(SEARCH)).not.toBeNull();
    expect(root.querySelector(PROJECT_NAME)).toBeNull();

    click(root, 'Cancel');
    await until(() => buttonNamed(root, 'New project') !== undefined, 'the start page');
    click(root, 'New project');
    await until(() => onWhere(root), 'the first step');
    expect(root.querySelector(PROJECT_NAME)).not.toBeNull();
    expect(root.querySelector(SEARCH)).toBeNull();
  });

  it.each(WAYS_IN)('%s walks Where, Structure, People and Idea in that order, says which step it is, then reviews', async (way) => {
    const { root } = await wayIn(way);
    const seen: Array<[string, string, string]> = [];
    for (const page of ['Where', 'Structure', 'People', 'Idea'] as const) {
      walkTo(root, page);
      if (page === 'Idea') type(root, THE_IDEA, IDEA);
      seen.push([page, text(root.querySelector('.step-progress p')), texts(root.querySelectorAll('.stepper li')).join(' ')]);
    }

    expect(seen).toEqual(
      ['Where', 'Structure', 'People', 'Idea'].map((page, index) => [page, `Step ${index + 1} of 4`, 'Where Structure People Idea']),
    );
    walkTo(root, 'Review');
    expect(root.querySelector('.stepper [aria-current="step"]')).toBeNull();
    expect(root.querySelectorAll('.stepper li.done')).toHaveLength(4);
  });

  it('stops Next on Where with the reason beside the name, for that step only, and takes the reason away when it is fixed', async () => {
    const { root, open } = app();
    await open();
    click(root, 'New project');
    await until(() => onWhere(root), 'the first step');

    click(root, 'Next');

    expect(pageNow(root)).toBe('Where');
    const reason = root.querySelector('.note.err') as HTMLElement;
    expect(text(reason)).toContain('Give the repository a name');
    expect(reason.parentElement?.querySelector(REPOSITORY_NAME)).not.toBeNull();

    type(root, REPOSITORY_NAME, 'sample-project-1');
    expect(root.querySelector('.note.err')).toBeNull();

    // An empty idea is the Idea step's problem: nothing before that step stops on it.
    walkTo(root, 'Idea');
    click(root, 'Next');
    expect(pageNow(root)).toBe('Idea');
    const noIdea = root.querySelector('.note.err') as HTMLElement;
    expect(text(noIdea)).toContain('Give the idea');
    expect(noIdea.parentElement?.querySelector(THE_IDEA)).not.toBeNull();
    type(root, THE_IDEA, IDEA);
    expect(root.querySelector('.note.err')).toBeNull();
  });

  it('puts a structure problem on the row that causes it, under the list when there is no row, and unfolds a folded structure', async () => {
    const { root } = await wayIn('Connect existing');
    walkTo(root, 'Structure');
    click(root, 'Edit');
    type(root.querySelectorAll('.rows.structure > li')[1], 'input[aria-label="Section name"]', 'Problem');
    click(root, 'Back');
    click(root, 'Create a new repository');
    click(root, 'Connect an existing one');
    walkTo(root, 'Structure');

    expect(sectionNames(root)).toEqual([]);
    click(root, 'Next');

    expect(pageNow(root)).toBe('Structure');
    const row = root.querySelectorAll('.rows.structure > li')[1];
    expect(text(row.querySelector('.note.err'))).toContain('Two sections are both called "Problem"');

    for (let left = sectionNames(root).length; left > 0; left -= 1) {
      click(root.querySelector('.rows.structure > li') as HTMLElement, 'Remove');
    }
    click(root, 'Next');
    expect(text(root.querySelector('.note.err'))).toBe('The PRD structure needs at least one section.');
    expect(root.querySelector('.note.err')?.parentElement?.textContent).toContain('Add section');
  });

  it('keeps everything typed on Back, in every step', async () => {
    const { root } = await wayIn('New project');
    const domain = 'input[aria-label="Add a domain"]';
    type(root, REPOSITORY_NAME, 'my-own-name');
    walkTo(root, 'Structure');
    type(root.querySelectorAll('.rows.structure > li')[0], 'input[aria-label="Section note"]', 'Sample changed note');
    walkTo(root, 'People');
    type(root, INVITE_LOGIN, 'ben-example');
    click(root, 'Invite');
    type(root, INVITE_LOGIN, 'half-typed');
    type(stepCard(root), '.field input', 'Sample role A');
    type(root, domain, 'half-a-domain');
    walkTo(root, 'Idea');
    type(root, THE_IDEA, IDEA);
    walkTo(root, 'Review');

    click(root, 'Back');
    expect(pageNow(root)).toBe('Idea');
    expect(value(root, THE_IDEA)).toBe(IDEA);
    click(root, 'Back');
    expect(pageNow(root)).toBe('People');
    expect(value(root, INVITE_LOGIN)).toBe('half-typed');
    expect(text(stepCard(root))).toContain('ben-example');
    expect(value(stepCard(root), '.field input')).toBe('Sample role A');
    expect(value(root, domain)).toBe('half-a-domain');
    click(root, 'Back');
    expect(pageNow(root)).toBe('Structure');
    expect(value(root.querySelectorAll('.rows.structure > li')[0], 'input[aria-label="Section note"]')).toBe('Sample changed note');
    click(root, 'Back');
    expect(pageNow(root)).toBe('Where');
    expect(value(root, PROJECT_NAME)).toBe('Sample project 1');
    expect(value(root, REPOSITORY_NAME)).toBe('my-own-name');
    expect(buttonNamed(root, 'Back')).toBeUndefined();
  });

  it('brings a new page to the top with its heading focused, and a stopped step to its reason', async () => {
    const { root } = await wayIn('New project');
    const toTop = vi.fn();
    (document.scrollingElement as Element).scrollTo = toTop;
    const toReason = vi.fn();
    const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Element.prototype.scrollIntoView = toReason;
    try {
      walkTo(root, 'Structure');
      expect(toTop).toHaveBeenCalledWith(0, 0);
      expect(document.activeElement).toBe(root.querySelector('.page-head h3'));

      type(root.querySelectorAll('.rows.structure > li')[1], 'input[aria-label="Section name"]', ' ');
      click(root, 'Next');
      expect(toReason.mock.contexts[0]).toBe(root.querySelector('[data-reason]'));
    } finally {
      if (scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView);
    }
  });

  it('keeps what was typed for each way in when the switch on Where changes it', async () => {
    const { root } = await wayIn('New project');
    click(root, 'Connect an existing one');
    type(root, SEARCH, 'example-org/team-docs');
    click(root, 'Create a new repository');
    expect(value(root, PROJECT_NAME)).toBe('Sample project 1');
    click(root, 'Connect an existing one');
    expect(value(root, SEARCH)).toBe('example-org/team-docs');
  });

  const answersOf = (root: HTMLElement, page: string) =>
    [...root.querySelectorAll<HTMLElement>('.review > li')].find((row) => text(row.querySelector('.strong')) === page) as HTMLElement;

  it('lists the answers of every step on the review page, and Change goes back to that step and returns with the edit', async () => {
    const { root: page } = await wayIn('New project');
    walkTo(page, 'People');
    type(page, INVITE_LOGIN, 'ben-example');
    click(page, 'Invite');
    type(stepCard(page), '.field input', 'Sample role A');
    type(page, 'input[aria-label="Add a domain"]', 'product');
    click(page, 'Add domain');
    walkTo(page, 'Idea');
    type(page, THE_IDEA, IDEA);
    walkTo(page, 'Review');

    expect(text(answersOf(page, 'Where'))).toContain('Sample project 1');
    expect(text(answersOf(page, 'Where'))).toContain('example-org/sample-project-1');
    expect(text(answersOf(page, 'Where'))).toContain('Private');
    expect(text(answersOf(page, 'Structure'))).toContain('Grillo default · 13 sections');
    expect(text(answersOf(page, 'Structure'))).toContain('Users and roles');
    expect(text(answersOf(page, 'People'))).toContain('Sample role A');
    expect(text(answersOf(page, 'People'))).toContain('product');
    expect(text(answersOf(page, 'People'))).toContain('ben-example');
    expect(text(answersOf(page, 'Idea'))).toContain(IDEA);

    click(answersOf(page, 'Where'), 'Change');
    expect(pageNow(page)).toBe('Where');
    type(page, PROJECT_NAME, 'Sample project 2');
    click(page, 'Back to review');
    expect(pageNow(page)).toBe('Review');
    expect(text(answersOf(page, 'Where'))).toContain('Sample project 2');

    for (const step of ['Structure', 'People', 'Idea'] as const) {
      click(answersOf(page, step), 'Change');
      expect(pageNow(page)).toBe(step);
      click(page, 'Back to review');
    }
  });

  it('shows Back to review only once the review was seen, and goes to the step with a problem instead of the review', async () => {
    const { root } = await wayIn('New project');
    expect(buttonNamed(root, 'Back to review')).toBeUndefined();
    walkTo(root, 'Idea');
    expect(buttonNamed(root, 'Back to review')).toBeUndefined();
    type(root, THE_IDEA, IDEA);
    walkTo(root, 'Review');

    click(answersOf(root, 'Idea'), 'Change');
    type(root, THE_IDEA, '  ');
    click(root, 'Back');
    click(root, 'Back to review');

    expect(pageNow(root)).toBe('Idea');
    expect(text(root.querySelector('.note.err'))).toContain('Give the idea');
  });

  it('repeats the Public warning on the review page, and says when a login or a domain was typed but never added', async () => {
    const { root } = await wayIn('New project');
    const owner = stepCard(root).querySelector('select') as HTMLSelectElement;
    owner.value = 'ada-example';
    owner.dispatchEvent(new Event('change'));
    click(root.querySelector('[aria-label="Visibility"]') as HTMLElement, 'Public');
    walkTo(root, 'People');
    type(root, INVITE_LOGIN, 'ben-example');
    type(root, 'input[aria-label="Add a domain"]', 'platform');
    walkTo(root, 'Idea');
    type(root, THE_IDEA, IDEA);
    walkTo(root, 'Review');

    expect(text(answersOf(root, 'Where'))).toContain('Public means anyone on the internet can read this project');
    expect(texts(answersOf(root, 'People').querySelectorAll('.reason'))).toEqual([
      'You typed ben-example but did not press Invite, so ben-example will not be invited.',
      'You typed platform but did not press Add domain, so it will not be saved.',
    ]);
  });

  it('on the review of a connection names the access, says why nobody is invited, and warns of read access', async () => {
    const { root } = await wayIn('Connect existing');
    type(root, SEARCH, 'example-org/company-handbook');
    walkTo(root, 'Idea');
    type(root, THE_IDEA, IDEA);
    walkTo(root, 'Review');

    expect(text(answersOf(root, 'Where'))).toContain('example-org/company-handbook');
    expect(text(answersOf(root, 'Where').querySelector('.badge'))).toBe('Read access only');
    expect(text(answersOf(root, 'Where').querySelector('.reason'))).toContain('Connecting needs write access.');
    expect(text(answersOf(root, 'People'))).toContain('inviting needs admin rights');
    expect(buttonNamed(root, 'Connect and start')).toBeDefined();
    expect(buttonNamed(root, 'Create project')).toBeUndefined();
  });

  it.each(WAYS_IN)('%s reaches creation from the review page and calls the store as before', async (way, action) => {
    const context = await wayIn(way);
    const { store, starts, root } = context;
    const created = vi.spyOn(store, 'createProject');
    fillConnection(root);

    click(root, action);
    await until(() => starts.length === 1, 'the grilling agent to start');

    expect(created.mock.calls).toHaveLength(1);
    expect(created.mock.calls[0][0]).toMatchObject(
      way === 'New project'
        ? { newRepository: { organisation: 'example-org', name: 'sample-project-1' } }
        : { connectRepository: { owner: 'example-org', name: 'team-docs' } },
    );
  });

  it('offers Where when GitHub refuses the new repository, keeps the answers, and creates once the name is changed', async () => {
    const { store, starts, root, open } = app();
    await open();
    click(root, 'New project');
    await until(() => onWhere(root), 'the first step');
    fillNewProject(root, 'team-code');

    click(root, 'Create project');
    await until(() => buttonNamed(root, 'Back to Where') !== undefined, 'the refusal');
    expect(text(root.querySelector('.note.err'))).toContain('team-code');
    expect(buttonNamed(root, 'Try again')).toBeDefined();

    click(root, 'Back to Where');
    expect(pageNow(root)).toBe('Where');
    expect(value(root, REPOSITORY_NAME)).toBe('team-code');
    type(root, REPOSITORY_NAME, 'sample-project-1');
    click(root, 'Back to review');
    expect(text(answersOf(root, 'Idea'))).toContain(IDEA);
    click(root, 'Create project');
    await until(() => starts.length === 1, 'the grilling agent to start');

    expect((await store.getProject('example-org/sample-project-1')).id).toBe('example-org/sample-project-1');
  });

  it.each([
    ['already holds a Grillo project', 'Open it'],
    ['has issues turned off', 'Check again'],
  ])('offers Pick another repository, with every answer kept, when the repository %s', async (problem, action) => {
    const seed: MemoryStoreOptions['seed'] = {
      repositories: [
        { repository: { owner: 'example-org', name: 'sample-repo-3' }, permission: 'write', issuesEnabled: true },
        { repository: { owner: 'example-org', name: 'sample-repo-4' }, permission: 'admin', issuesEnabled: false },
      ],
    };
    const context = app({ seed });
    const { store, root } = context;
    await store.createProject({ connectRepository: { owner: 'example-org', name: 'sample-repo-3' } });
    await context.open();
    click(root, 'Connect existing');
    await until(() => onWhere(root), 'the first step');
    type(root, SEARCH, problem === 'has issues turned off' ? 'example-org/sample-repo-4' : 'example-org/sample-repo-3');
    fillConnection(root);

    click(root, 'Connect and start');
    await until(() => buttonNamed(root, action) !== undefined, 'the repository problem');
    expect(pageNow(root)).toBe('Where');

    click(root, 'Pick another repository');
    expect(pageNow(root)).toBe('Where');
    expect(root.querySelector(SEARCH)).not.toBeNull();
    walkTo(root, 'Idea');
    expect(value(root, THE_IDEA)).toBe(IDEA);
  });
});
