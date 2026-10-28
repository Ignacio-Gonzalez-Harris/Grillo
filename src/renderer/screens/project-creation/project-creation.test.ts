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
  ipc.handle('tools:identity', () => ({ ok: true as const, identity: { login: 'ada-example', name: 'Ada Example', email: null } }));

  const navigate = vi.fn<(screenId: string, params?: ScreenParams) => void>();
  const shell: ShellContext = {
    grillo: createGrilloApi(fake.renderer),
    navigate,
    agentTabHeader: () => undefined,
    onAgentTabs: () => () => undefined,
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
});

describe('project creation: connecting an existing repository', () => {
  async function connectForm(context: ReturnType<typeof app>, repository: string) {
    await context.open();
    click(context.root, 'New project');
    await until(() => cardTitled(context.root, '1 · Repository') !== undefined, 'the form');
    click(context.root, 'Connect an existing one');
    type(context.root, 'input[aria-label="Repository to connect"]', repository);
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
