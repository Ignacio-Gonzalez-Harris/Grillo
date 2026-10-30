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
    await until(() => cardTitled(root, '1 · Repository') !== undefined, 'the form');
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });

    type(root, 'input[aria-label="Project name"]', 'Sample project 1');
    expect(root.querySelector<HTMLInputElement>('input[aria-label="Repository name"]')?.value).toBe('sample-project-1');
    const structure = cardTitled(root, '2 · PRD structure');
    expect(sectionNames(structure)).toEqual(DEFAULT_PRD_STRUCTURE.sections.map((section) => section.name));
    click(structure, 'Add section');
    const names = root.querySelectorAll<HTMLInputElement>('input[aria-label="Section name"]');
    type(names[names.length - 1].parentElement as HTMLElement, 'input[aria-label="Section name"]', 'Sample added section');
    root.querySelectorAll<HTMLButtonElement>('button[aria-label="Move down"]')[0].click();
    click(cardTitled(root, '2 · PRD structure').querySelectorAll('.rows > li')[12], 'Remove');
    type(root, 'input[aria-label="GitHub login to invite"]', 'ben-example');
    click(root, 'Invite');
    type(cardTitled(root, '3 · Members'), '.field input', 'Sample role A');
    type(root, 'input[aria-label="Add a domain"]', 'product');
    click(root, 'Add domain');
    type(root, 'textarea[aria-label="The idea"]', IDEA);

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
    await until(() => cardTitled(root, '3 · Members') !== undefined, 'the form');

    const members = cardTitled(root, '3 · Members');
    expect(members.querySelector<HTMLInputElement>('.field input')?.value).toBe('Sample role A');
    expect(texts(members.querySelectorAll('.tag'))).toEqual(['product×']);
    expect(text(members)).toContain('Pre-filled from the last project you joined, example-org/sample-project-0.');

    const from = cardTitled(root, '2 · PRD structure').querySelector('select') as HTMLSelectElement;
    expect(texts(from.options)).toEqual(['Grillo default', 'sample-project-0 (an earlier project of yours)']);
    from.value = 'example-org/sample-project-0';
    from.dispatchEvent(new Event('change'));
    expect(sectionNames(root)).toEqual(['Sample section 1']);
  });

  it.each([
    ['no idea', (root: HTMLElement) => type(root, 'input[aria-label="Repository name"]', 'sample-project-1'), 'Give the idea'],
    [
      'two sections with one name',
      (root: HTMLElement) => {
        type(root, 'input[aria-label="Repository name"]', 'sample-project-1');
        type(root, 'textarea[aria-label="The idea"]', IDEA);
        type(root.querySelectorAll('.rows.structure > li')[1], 'input[aria-label="Section name"]', 'Problem');
      },
      'Two sections are both called "Problem"',
    ],
  ])('refuses to create a project with %s, saying why, and creates nothing', async (_case, fill, message) => {
    const { store, starts, root, open } = app();
    await open();
    click(root, 'New project');
    await until(() => cardTitled(root, '4 · The idea') !== undefined, 'the form');

    fill(root);
    click(root, 'Create project');
    await flush();

    expect(text(root.querySelector('.note.err'))).toContain(message);
    expect(await store.listProjects()).toEqual([]);
    expect(starts).toEqual([]);
  });

  it('shows a failed step with its reason, and Try again resumes there without saving the idea twice', async () => {
    const { store, starts, root, open } = app({ failAgentStarts: 1 });
    await open();
    click(root, 'New project');
    await until(() => cardTitled(root, '4 · The idea') !== undefined, 'the form');
    type(root, 'input[aria-label="Repository name"]', 'sample-project-1');
    type(root, 'textarea[aria-label="The idea"]', IDEA);

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
    await until(() => cardTitled(root, '4 · The idea') !== undefined, 'the form');
    type(root, 'input[aria-label="Repository name"]', 'sample-project-1');
    // Your own login: with no identity the form cannot catch it, and the store refuses it as a member already.
    for (const login of ['ada-example', 'ben-example']) {
      type(root, 'input[aria-label="GitHub login to invite"]', login);
      click(root, 'Invite');
    }
    type(root, 'textarea[aria-label="The idea"]', IDEA);

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
    click(context.root, 'New project');
    await until(() => cardTitled(context.root, '1 · Repository') !== undefined, 'the form');
    click(context.root, 'Connect an existing one');
    type(context.root, 'input[aria-label="Search repositories"]', repository);
  }

  it('greys out inviting with the reason, folds the structure, and starts the agent on a pasted transcript', async () => {
    const context = app();
    const { store, starts, root } = context;
    await connectForm(context, 'example-org/team-code');

    click(root, 'Check access');
    await until(() => root.querySelector('.badge.warn') !== null, 'the access check');
    const members = cardTitled(root, '3 · Members');
    expect(members.querySelector<HTMLInputElement>('input[aria-label="GitHub login to invite"]')?.disabled).toBe(true);
    expect(buttonNamed(members, 'Invite')?.disabled).toBe(true);
    expect(text(members.querySelector('.reason'))).toContain('Inviting needs admin rights on example-org/team-code');
    expect(text(cardTitled(root, '2 · PRD structure'))).toContain('Grillo default · 13 sections');

    click(root, 'Paste or upload a transcript');
    type(root, 'textarea[aria-label="Transcript"]', 'Sample transcript line 1: a made-up kick-off remark.');
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
    type(root, 'textarea[aria-label="The idea"]', IDEA);

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
    type(root, 'textarea[aria-label="The idea"]', IDEA);

    click(root, 'Connect and start');
    await until(() => root.querySelector('.badge.err') !== null, 'the repository problem');

    expect(text(root.querySelector('.badge.err'))).toBe('Cannot connect');
    expect(text(root.querySelector('.rows p'))).toContain('Issues are turned off in example-org/sample-repo-4');
    click(root, 'Check again');
    await until(() => cardTitled(root, '4 · The idea') !== undefined, 'the form again');
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
  const repositoryRows = (root: HTMLElement) => [...cardTitled(root, '1 · Repository').querySelectorAll('.rows > li')];
  const radio = (root: HTMLElement, label: string) =>
    repositoryRows(root).find((row) => text(row.querySelector('label')) === label)?.querySelector<HTMLInputElement>('input[type="radio"]');

  async function listed(context: ReturnType<typeof app>) {
    await context.open();
    click(context.root, 'New project');
    await until(() => cardTitled(context.root, '1 · Repository') !== undefined, 'the form');
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
    expect(text(cardTitled(root, '1 · Repository'))).toContain('No repository of yours matches this search.');
  });

  it('picking a repository selects it with no Check access: an admin may invite, and connecting uses that repository', async () => {
    const context = app({ seed });
    const { store, starts, root } = context;
    await listed(context);

    (radio(root, 'example-org/sample-repo-2') as HTMLInputElement).click();

    expect(radio(root, 'example-org/sample-repo-2')?.checked).toBe(true);
    expect(radio(root, 'example-org/sample-repo-1')?.checked).toBe(false);
    expect(repositoryRows(root)[2].classList.contains('selected')).toBe(true);
    expect(root.querySelector<HTMLInputElement>('input[aria-label="GitHub login to invite"]')?.disabled).toBe(false);

    type(root, 'textarea[aria-label="The idea"]', IDEA);
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
    expect(text(cardTitled(root, '3 · Members').querySelector('.reason'))).toContain('Grillo has not confirmed your access yet');
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
    expect(text(cardTitled(root, '3 · Members'))).toContain('Inviting needs admin rights on example-org/other-repo');
    expect(repositoryRows(root).map((row) => text(row.querySelector('.strong')))).toContain('example-org/other-repo');
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
    click(root, 'Connect and start');
    await flush();
    expect(text(root.querySelector('.note.err'))).toContain('Pick the repository to connect');
  });

  it('says so when the list cannot be read, and a repository can still be typed in full', async () => {
    const context = app({ seed });
    const { store, root } = context;
    vi.spyOn(store, 'listRepositories').mockRejectedValue(new Error('gh is signed out'));
    await listed(context);

    expect(text(cardTitled(root, '1 · Repository').querySelector('.note.warn'))).toBe(
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
    await until(() => cardTitled(root, '1 · Repository') !== undefined, 'the form');
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
    await until(() => cardTitled(root, '4 · The idea') !== undefined, 'the form');
    type(root, 'input[aria-label="Project name"]', 'Sample project 1');
    type(root, 'textarea[aria-label="The idea"]', IDEA);
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
    await until(() => cardTitled(root, '4 · The idea') !== undefined, 'the form');
    type(root, 'input[aria-label="Repository name"]', 'sample-project-1');
    type(root, 'textarea[aria-label="The idea"]', IDEA);

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
