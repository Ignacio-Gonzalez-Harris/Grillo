import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRD_STRUCTURE } from '../../defaults';
import { createMemorySettings } from '../../memory/settings';
import { StoreError, type NewSource } from '../../store';
import type { Score } from '../../types';
import { createRepoStore, REPO_METHODS } from '.';
import { createFakeGithub, readTree, type FakeRepository } from './fake-github';
import type { PullRequestNotice } from './folder';
import { GRILLO_LABELS } from './github-api';

const PROJECT = 'example-org/demo';
const START = new Date('2026-10-24T09:15:00.000Z');
const STRUCTURE = { sections: [{ name: 'Problem', note: 'What goes wrong today' }] };
const SOURCE: NewSource = { kind: 'pasted-text', who: 'Ben Example, product', when: '2026-10-23T10:00:00.000Z', where: 'email to Ada', text: 'We need a PRD.' };
const SCORE: Score = { overall: 6.5, criteria: [{ name: 'Clear', mark: 7, comment: 'Plain words' }], sections: [] };

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'grillo-repo-'));
  roots.push(root);
  const github = createFakeGithub();
  github.users.set('ben-example', { login: 'ben-example', name: 'Ben Example', email: null });
  const settings = createMemorySettings();
  const notices: PullRequestNotice[] = [];
  let clock = START;
  const store = createRepoStore({
    gh: github.gh,
    git: github.git,
    settings,
    folderRoot: root,
    now: () => clock,
    onPullRequest: (notice) => notices.push(notice),
  });
  const seed = (id = PROJECT, options: Partial<FakeRepository> = {}, members = [{ login: 'ada-example', role: 'developer', domains: ['platform'] }]) =>
    github.addRepository(id, {
      ...options,
      files: {
        'README.md': '# Demo\n',
        '.grillo/members.json': JSON.stringify(members),
        '.grillo/structure.json': JSON.stringify(STRUCTURE),
      },
    });
  return {
    root,
    github,
    settings,
    store,
    notices,
    seed,
    folder: (id = PROJECT) => join(root, ...id.split('/')),
    later: (seconds: number) => (clock = new Date(clock.getTime() + seconds * 1000)),
  };
}

async function refusal(promise: Promise<unknown>): Promise<StoreError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(StoreError);
  return error as StoreError;
}

const remoteJson = (repository: FakeRepository, path: string): unknown => JSON.parse(repository.files.get(path) ?? 'null');

describe('GitHub repository backend: createProject', () => {
  it('creates a private repository in the organisation with labels, members.json and structure.json on main', async () => {
    const { store, github, folder } = await setup();

    const project = await store.createProject({ newRepository: { organisation: 'example-org', name: 'demo' } });

    const repository = github.repositories.get(PROJECT)!;
    expect(github.calls).toContain('gh repo create example-org/demo --private --add-readme');
    expect(repository.topics).toEqual(['grillo-created']);
    expect([...repository.labels.keys()]).toEqual(GRILLO_LABELS.map((label) => label.name));
    expect(remoteJson(repository, '.grillo/members.json')).toEqual([{ login: 'ada-example', role: '', domains: [] }]);
    expect(remoteJson(repository, '.grillo/structure.json')).toEqual(DEFAULT_PRD_STRUCTURE);
    expect(project).toEqual({
      id: PROJECT,
      name: 'demo',
      repository: { owner: 'example-org', name: 'demo' },
      structure: DEFAULT_PRD_STRUCTURE,
      members: [{ login: 'ada-example', name: 'Ada Example', email: 'ada@example.com', role: '', domains: [] }],
      archived: false,
    });
    expect(existsSync(join(folder(), '.grillo', 'members.json'))).toBe(true);
  });

  it('refuses a repository name GitHub would not accept, and one that already exists', async () => {
    const { store, seed } = await setup();
    seed();

    expect((await refusal(store.createProject({ newRepository: { organisation: 'example-org', name: 'my demo' } }))).kind).toBe('invalid');
    expect((await refusal(store.createProject({ newRepository: { organisation: 'example-org', name: 'demo' } }))).kind).toBe('conflict');
  });

  it('connects an existing repository with write access, ignoring what it already holds', async () => {
    const { store, github } = await setup();
    const repository = github.addRepository('example-org/team-code', { permission: 'write', files: { 'src/app.ts': 'code\n' } });

    const project = await store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' }, structure: STRUCTURE });

    expect(project.structure).toEqual(STRUCTURE);
    expect(repository.files.get('src/app.ts')).toBe('code\n');
    expect(remoteJson(repository, '.grillo/structure.json')).toEqual(STRUCTURE);
    expect(repository.labels.size).toBe(GRILLO_LABELS.length);
    await expect(store.viewerPermission('example-org/team-code')).resolves.toBe('write');
  });

  it('refuses admin-only actions in a connected repository with the reason, for a member with write access', async () => {
    const { store, seed } = await setup();
    seed(PROJECT, { permission: 'write' });

    const invite = await refusal(store.addMember(PROJECT, { login: 'ben-example', role: '', domains: [] }));
    const close = await refusal(store.archiveProject(PROJECT));

    expect(invite).toMatchObject({ kind: 'forbidden', message: `Only an admin of the repository ${PROJECT} may invite people; ask one of its admins` });
    expect(close).toMatchObject({ kind: 'forbidden', message: expect.stringContaining('may close the project') });
  });

  it.each([
    ['read access only', { permission: 'read' as const }, 'forbidden'],
    ['issues turned off', { hasIssues: false }, 'invalid'],
  ])('refuses to connect a repository with %s', async (_case, options, kind) => {
    const { store, github } = await setup();
    github.addRepository('example-org/team-code', options);

    expect((await refusal(store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' } }))).kind).toBe(kind);
  });

  it('opens the existing project when the connected repository already holds one, changing nothing', async () => {
    const { store, github, seed } = await setup();
    const repository = seed();
    const before = repository.version;

    const project = await store.createProject({ connectRepository: { owner: 'example-org', name: 'demo' } });

    expect(project.structure).toEqual(STRUCTURE);
    expect(project.members.map((member) => member.role)).toEqual(['developer']);
    expect(repository.version).toBe(before);
    expect(github.calls.some((call) => call.startsWith('gh label create'))).toBe(false);
  });
});

describe('GitHub repository backend: members and invitations', () => {
  it('reads members.json with each name and email from GitHub, and the signed-in member', async () => {
    const { store, seed } = await setup();
    seed(PROJECT, {}, [
      { login: 'ada-example', role: 'developer', domains: ['platform'] },
      { login: 'ben-example', role: 'product', domains: [] },
    ]);

    const members = await store.listMembers(PROJECT);

    expect(members).toEqual([
      { login: 'ada-example', name: 'Ada Example', email: 'ada@example.com', role: 'developer', domains: ['platform'] },
      { login: 'ben-example', name: 'Ben Example', email: null, role: 'product', domains: [] },
    ]);
    await expect(store.getMember(PROJECT, 'ben-example')).resolves.toEqual(members[1]);
    await expect(store.currentMember(PROJECT)).resolves.toEqual(members[0]);
    expect((await refusal(store.getMember(PROJECT, 'cy-example'))).kind).toBe('not-found');
  });

  it.each([
    ['a repository Grillo created', ['grillo-created'], 'permission=admin'],
    ['a connected repository', [], 'permission=push'],
  ])('invites a member to %s as a repository collaborator and writes their line', async (_case, topics, permission) => {
    const { store, seed } = await setup();
    const repository = seed(PROJECT, { topics });

    const added = await store.addMember(PROJECT, { login: 'ben-example', role: 'product', domains: ['billing'] });

    expect(added).toEqual({ login: 'ben-example', name: 'Ben Example', email: null, role: 'product', domains: ['billing'] });
    expect(repository.invitations.map((invitation) => `permission=${invitation.permission}`)).toEqual([permission]);
    expect(remoteJson(repository, '.grillo/members.json')).toEqual([
      { login: 'ada-example', role: 'developer', domains: ['platform'] },
      { login: 'ben-example', role: 'product', domains: ['billing'] },
    ]);
    expect((await refusal(store.addMember(PROJECT, { login: 'ben-example', role: '', domains: [] }))).kind).toBe('conflict');
    expect((await refusal(store.addMember(PROJECT, { login: 'ben/../x', role: '', domains: [] }))).kind).toBe('invalid');
  });

  it('updates a member line, and removes a member with their pending invitation', async () => {
    const { store, seed } = await setup();
    const repository = seed();
    await store.addMember(PROJECT, { login: 'ben-example', role: 'product', domains: [] });

    const updated = await store.updateMember(PROJECT, 'ben-example', { domains: ['billing'] });
    await store.removeMember(PROJECT, 'ben-example');

    expect(updated).toMatchObject({ role: 'product', domains: ['billing'] });
    expect(remoteJson(repository, '.grillo/members.json')).toEqual([{ login: 'ada-example', role: 'developer', domains: ['platform'] }]);
    expect(repository.invitations).toEqual([]);
    expect((await refusal(store.removeMember(PROJECT, 'ben-example'))).kind).toBe('not-found');
  });

  it('lists and accepts pending invitations through gh api user/repository_invitations', async () => {
    const { store, github } = await setup();
    github.invitations.push({ id: 7, repository: 'example-org/kickoff-notes', inviter: 'ben-example', createdAt: '2026-10-20T09:00:00.000Z' });

    const pending = await store.listPendingInvitations();
    await store.acceptInvitation(7);

    expect(pending).toEqual([
      { id: 7, repository: { owner: 'example-org', name: 'kickoff-notes' }, inviter: 'ben-example', createdAt: '2026-10-20T09:00:00.000Z' },
    ]);
    expect(github.calls).toContain('gh api --method PATCH user/repository_invitations/7');
    await expect(store.listPendingInvitations()).resolves.toEqual([]);
    expect((await refusal(store.acceptInvitation(7))).kind).toBe('not-found');
  });

  it('lists the organisations from gh api user/orgs and the recent projects from the settings file', async () => {
    const { store, seed, later } = await setup();
    seed();
    seed('example-org/other');

    await store.openProjectFolder(PROJECT);
    later(60);
    await store.openProjectFolder('example-org/other');

    await expect(store.listOrganisations()).resolves.toEqual([{ login: 'example-org', name: null }]);
    await expect(store.listRecentProjects()).resolves.toEqual([
      { project: 'example-org/other', lastOpened: '2026-10-24T09:16:00.000Z' },
      { project: PROJECT, lastOpened: '2026-10-24T09:15:00.000Z' },
    ]);
    expect((await store.listProjects()).map((project) => project.id)).toEqual(['example-org/other', PROJECT]);
  });
});

describe('GitHub repository backend: Grillo folder files', () => {
  it('numbers sources S1, S2 from main and reads them back word for word', async () => {
    const { store, seed } = await setup();
    const repository = seed();

    const first = await store.createSource(PROJECT, SOURCE);
    const second = await store.createSource(PROJECT, { ...SOURCE, text: 'Line one\n\nLine three' });

    expect([first.code, second.code]).toEqual(['S1', 'S2']);
    expect(repository.files.get('.grillo/sources/S2.md')).toBe(
      'kind: pasted-text\nwho: Ben Example, product\nwhen: 2026-10-23T10:00:00.000Z\nwhere: email to Ada\n\nLine one\n\nLine three',
    );
    await expect(store.getSource(PROJECT, 'S2')).resolves.toEqual(second);
    await expect(store.listSources(PROJECT)).resolves.toEqual([first, second]);
  });

  it('takes the next free number when someone else pushed the same one first', async () => {
    const { store, github, seed, folder } = await setup();
    const repository = seed();
    github.onNextPush(() => github.pushFromElsewhere(PROJECT, '.grillo/sources/S1.md', 'kind: meeting\nwho: Ben\nwhen: w\nwhere: call\n\nTheirs'));

    const source = await store.createSource(PROJECT, SOURCE);

    expect(source.code).toBe('S2');
    expect(repository.files.get('.grillo/sources/S1.md')).toContain('Theirs');
    expect(repository.files.get('.grillo/sources/S2.md')).toContain(SOURCE.text);
    expect(readTree(folder())).toEqual(repository.files);
  });

  it('gives up with a conflict when others keep pushing first', async () => {
    const { store, github, seed } = await setup();
    seed();
    const pushFirst = (round: number): void =>
      github.onNextPush(() => {
        github.pushFromElsewhere(PROJECT, `.grillo/sources/S${round}.md`, 'kind: meeting\nwho: B\nwhen: w\nwhere: c\n\nx');
        if (round < 3) pushFirst(round + 1);
      });
    pushFirst(1);

    expect((await refusal(store.createSource(PROJECT, SOURCE))).kind).toBe('conflict');
  });

  it('numbers two sources saved at the same moment one after the other', async () => {
    const { store, seed } = await setup();
    seed();

    const codes = await Promise.all([store.createSource(PROJECT, SOURCE), store.createSource(PROJECT, SOURCE)]);

    expect(codes.map((source) => source.code).sort()).toEqual(['S1', 'S2']);
  });

  it('opens a pull request when main is protected, tells the member, and leaves main and the folder as they were', async () => {
    const { store, github, seed, notices, folder } = await setup();
    const repository = seed(PROJECT, { protected: true });

    const source = await store.createSource(PROJECT, SOURCE);

    expect(source.code).toBe('S1');
    expect(repository.files.has('.grillo/sources/S1.md')).toBe(false);
    const head = `grillo/save-${START.getTime()}`;
    expect(repository.pullRequests).toEqual([{ base: 'main', head, title: 'grillo: add source S1' }]);
    expect(repository.branches.get(head)?.get('.grillo/sources/S1.md')).toContain(SOURCE.text);
    expect(notices).toEqual([{ project: PROJECT, url: `https://github.com/${PROJECT}/pull/1` }]);
    expect(readTree(folder())).toEqual(repository.files);
    expect(github.calls).toContain('git reset --keep HEAD~1');
  });

  it('refuses to save over a Grillo file changed in the project folder but not saved, and keeps the change', async () => {
    const { store, seed, folder } = await setup();
    const repository = seed();
    await store.openProjectFolder(PROJECT);
    const members = join(folder(), '.grillo', 'members.json');
    const localEdit = '[{"login":"ada-example","role":"edited by hand","domains":[]}]';
    writeFileSync(members, localEdit);

    const error = await refusal(store.updateMember(PROJECT, 'ada-example', { role: 'lead' }));

    expect(error).toMatchObject({ kind: 'conflict', message: expect.stringContaining('.grillo/members.json') });
    expect(readFileSync(members, 'utf8')).toBe(localEdit);
    expect(remoteJson(repository, '.grillo/members.json')).toEqual([{ login: 'ada-example', role: 'developer', domains: ['platform'] }]);
  });

  it('starts a session, records consent by the signed-in member, and keeps the transcript', async () => {
    const { store, seed, later } = await setup();
    const repository = seed();

    const started = await store.createSession(PROJECT, { present: ['ada-example'] });
    later(60);
    const updated = await store.updateSession(PROJECT, started.id, { consent: true, transcript: 'Ada: hello.' });

    expect(started).toEqual({ id: '2026-10-24-091500', date: START.toISOString(), present: ['ada-example'], consent: null, transcript: '' });
    expect(updated.consent).toEqual({ by: 'ada-example', at: '2026-10-24T09:16:00.000Z' });
    expect(repository.files.get('.grillo/sessions/2026-10-24-091500.md')).toBe(
      'date: 2026-10-24T09:15:00.000Z\npresent: ada-example\nconsent-by: ada-example\nconsent-at: 2026-10-24T09:16:00.000Z\n\nAda: hello.',
    );
    await expect(store.listSessions(PROJECT)).resolves.toEqual([updated]);
    expect((await refusal(store.createSession(PROJECT, { present: ['cy-example'] }))).kind).toBe('invalid');
    await store.createSession(PROJECT, { present: [] });
    expect((await refusal(store.createSession(PROJECT, { present: [] }))).kind).toBe('conflict');
  });

  it('reads and replaces the PRD structure', async () => {
    const { store, seed } = await setup();
    const repository = seed();
    const next = { sections: [...STRUCTURE.sections, { name: 'Flows', note: 'Step by step' }] };

    await expect(store.getStructure(PROJECT)).resolves.toEqual(STRUCTURE);
    await expect(store.updateStructure(PROJECT, next)).resolves.toEqual(next);

    expect(remoteJson(repository, '.grillo/structure.json')).toEqual(next);
    expect((await refusal(store.updateStructure(PROJECT, { sections: [] }))).kind).toBe('invalid');
  });

  it('numbers PRD versions, keeps each as written, and stores, replaces and clears its score', async () => {
    const { store, seed } = await setup();
    const repository = seed();

    const first = await store.createPrdVersion(PROJECT, { body: '# PRD\n\nWith [S1].', appendix: '# Audit' });
    const second = await store.createPrdVersion(PROJECT, { body: '# PRD v2', appendix: '' });
    await store.setScore(PROJECT, 1, SCORE);

    expect([first.number, second.number]).toEqual([1, 2]);
    expect(remoteJson(repository, '.grillo/prd/v1.score.json')).toEqual(SCORE);
    await expect(store.getPrdVersion(PROJECT, 1)).resolves.toEqual({ ...first, score: SCORE });
    await expect(store.listPrdVersions(PROJECT)).resolves.toEqual([{ ...first, score: SCORE }, second]);
    await expect(store.setScore(PROJECT, 1, null)).resolves.toBeNull();
    expect(repository.files.has('.grillo/prd/v1.score.json')).toBe(false);
    await expect(store.getScore(PROJECT, 1)).resolves.toBeNull();
    expect((await refusal(store.setScore(PROJECT, 1, { ...SCORE, overall: 11 }))).kind).toBe('invalid');
    expect((await refusal(store.getScore(PROJECT, 3))).kind).toBe('not-found');
    expect((await refusal(store.createPrdVersion(PROJECT, { body: 'a\n<!-- grillo:appendix -->\nb', appendix: '' }))).kind).toBe('invalid');
  });
});

describe('GitHub repository backend: project folder', () => {
  it('clones into <root>/<owner>/<repo> with gh repo clone, then updates with git pull --ff-only', async () => {
    const { store, github, seed, folder } = await setup();
    seed();

    const path = await store.openProjectFolder(PROJECT);
    github.pushFromElsewhere(PROJECT, 'notes.md', 'New on GitHub\n');
    await store.openProjectFolder(PROJECT);

    expect(path).toBe(folder());
    expect(github.calls).toContain(`gh repo clone ${PROJECT} ${folder()}`);
    expect(github.calls).toContain('git pull --ff-only');
    expect(readFileSync(join(folder(), 'notes.md'), 'utf8')).toBe('New on GitHub\n');
  });

  it('reports a folder with unsaved changes and leaves them untouched', async () => {
    const { store, github, seed, folder } = await setup();
    seed();
    await store.openProjectFolder(PROJECT);
    writeFileSync(join(folder(), 'README.md'), 'My local edit\n');

    const error = await refusal(store.openProjectFolder(PROJECT));

    expect(error).toMatchObject({ kind: 'conflict', message: expect.stringContaining('README.md') });
    expect(readFileSync(join(folder(), 'README.md'), 'utf8')).toBe('My local edit\n');
    expect(github.calls.filter((call) => call === 'git pull --ff-only')).toEqual([]);
  });
});

describe('GitHub repository backend: archive and unarchive', () => {
  it('archives a project so it stays readable and refuses every change, until it is unarchived', async () => {
    const { store, github, seed } = await setup();
    const repository = seed();

    await store.archiveProject(PROJECT);

    expect(github.calls).toContain(`gh api --method PATCH repos/${PROJECT} -F archived=true`);
    expect((await store.getProject(PROJECT)).archived).toBe(true);
    await expect(store.getStructure(PROJECT)).resolves.toEqual(STRUCTURE);
    for (const write of [
      () => store.createSource(PROJECT, SOURCE),
      () => store.updateMember(PROJECT, 'ada-example', { role: 'lead' }),
      () => store.updateStructure(PROJECT, STRUCTURE),
      () => store.createSession(PROJECT, { present: [] }),
    ]) {
      expect((await refusal(write())).kind).toBe('read-only');
    }

    await store.unarchiveProject(PROJECT);

    expect(repository.archived).toBe(false);
    await expect(store.createSource(PROJECT, SOURCE)).resolves.toMatchObject({ code: 'S1' });
  });
});

describe('GitHub repository backend: untrusted input', () => {
  it('refuses every method called without its arguments as invalid, before running gh or git', async () => {
    const { store, github } = await setup();
    const takingNone = ['listOrganisations', 'listPendingInvitations', 'listProjects', 'listRecentProjects'];

    for (const method of REPO_METHODS.filter((name) => !takingNone.includes(name))) {
      const error = await refusal((store[method] as () => Promise<unknown>)());
      expect(error.kind, method).toBe('invalid');
    }
    expect(github.calls).toEqual([]);
  });

  it.each([['../demo'], ['example-org/demo/extra'], ['example-org'], [undefined]])('refuses %s as a project id', async (id) => {
    const { store } = await setup();

    expect((await refusal(store.getProject(id as string))).kind).toBe('invalid');
  });

  it.each([['../members.json'], ['S0'], ['S1/../../x'], ['s1']])('reads no file for the source code %s', async (code) => {
    const { store, seed } = await setup();
    seed();

    expect((await refusal(store.getSource(PROJECT, code))).kind).toBe('not-found');
  });

  it('refuses a session id that is not <date>-<time>', async () => {
    const { store, seed } = await setup();
    seed();

    expect((await refusal(store.getSession(PROJECT, '../members'))).kind).toBe('not-found');
  });

  it('reports a damaged members file as a backend error naming it', async () => {
    const { store, github } = await setup();
    github.addRepository(PROJECT, { files: { '.grillo/members.json': '[null]', '.grillo/structure.json': JSON.stringify(STRUCTURE) } });

    expect(await refusal(store.listMembers(PROJECT))).toMatchObject({ kind: 'backend', message: expect.stringContaining('.grillo/members.json') });
  });

  it('reports a repository with no Grillo folder as not found', async () => {
    const { store, github } = await setup();
    github.addRepository(PROJECT);

    expect((await refusal(store.getProject(PROJECT))).kind).toBe('not-found');
  });

  it('reports a repository that does not exist as not found', async () => {
    const { store } = await setup();

    expect((await refusal(store.getProject('example-org/missing'))).kind).toBe('not-found');
  });
});
