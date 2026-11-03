import { describe, expect, it } from 'vitest';
import { DEFAULT_PRD_STRUCTURE } from '../defaults';
import { StoreError, type NewTicket, type Store, type StoreErrorKind } from '../store';
import type { Score, TicketId } from '../types';
import { createMemoryStore, type MemoryStore } from '.';

// Every test drives the store through the Store interface; only `addMemberComment` stages GitHub's side.
const PROJECT = 'example-org/grilling-demo';
const OTHER = 'ben-example';
const START = new Date('2026-10-24T09:15:00.000Z');

function clock() {
  let current = START.getTime();
  return { now: () => new Date(current), advance: (ms: number) => (current += ms) };
}

function newTicket(overrides: Partial<NewTicket> = {}): NewTicket {
  return {
    title: 'Login flow',
    question: 'How do members sign in?',
    whyItMatters: 'Every screen needs a member',
    assumptions: ['GitHub accounts exist'],
    kind: 'grilling',
    blockers: [],
    questions: ['Which provider?', 'Is single sign-on needed?'],
    ...overrides,
  };
}

async function refusal(promise: Promise<unknown>): Promise<StoreErrorKind> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(StoreError);
  return (error as StoreError).kind;
}

/** A project with a map, the member and a teammate declaring domains, and one ticket. */
async function projectWithTicket(): Promise<{ store: MemoryStore; ticket: TicketId; advance: (ms: number) => void }> {
  const { now, advance } = clock();
  const store = createMemoryStore({ now });
  await store.createProject({ newRepository: { organisation: 'example-org', name: 'grilling-demo' } });
  await store.updateMember(PROJECT, 'ada-example', { role: 'developer', domains: ['platform'] });
  await store.addMember(PROJECT, { login: OTHER, role: 'product owner', domains: ['product'] });
  await store.createMap(PROJECT, { destination: 'A PRD', notes: '', fog: [], outOfScope: [] });
  const created = await store.createTicket(PROJECT, newTicket());
  return { store, ticket: created.id, advance };
}

describe('in-memory store: the member and their GitHub surroundings', () => {
  it('reports the GitHub identity with the role and domains of the members file', async () => {
    const { store } = await projectWithTicket();

    await expect(store.currentMember(PROJECT)).resolves.toEqual({
      login: 'ada-example',
      name: 'Ada Example',
      email: 'ada@example.com',
      role: 'developer',
      domains: ['platform'],
    });
  });

  it('lists the organisations and pending invitations, and accepting one removes it', async () => {
    const store = createMemoryStore();
    expect(await store.listOrganisations()).toEqual([{ login: 'example-org', name: 'Example Org' }]);
    const [invitation] = await store.listPendingInvitations();

    await store.acceptInvitation(invitation.id);

    expect(await store.listPendingInvitations()).toEqual([]);
    expect(await refusal(store.acceptInvitation(invitation.id))).toBe('not-found');
  });

  it('answers the access level of a repository that is no project yet, and refuses one the member cannot reach', async () => {
    const store = createMemoryStore();

    expect(await store.viewerPermission('example-org/team-code')).toBe('write');
    expect(await refusal(store.viewerPermission('example-org/kickoff-notes'))).toBe('not-found');
  });

  it('makes a seeded invitation a project the member belongs to, so their role and domains can be saved', async () => {
    const store = createMemoryStore();
    const [invitation] = await store.listPendingInvitations();

    await store.acceptInvitation(invitation.id);

    expect(await store.viewerPermission('example-org/kickoff-notes')).toBe('write');
    expect((await store.currentMember('example-org/kickoff-notes')).login).toBe('ada-example');
    await expect(store.updateMember('example-org/kickoff-notes', 'ada-example', { role: 'developer' })).resolves.toMatchObject({ role: 'developer' });
  });

  it('adds the member to the project of an invitation when that project already exists', async () => {
    const store = createMemoryStore();
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'kickoff-notes' } });
    await store.removeMember('example-org/kickoff-notes', 'ada-example');
    const [invitation] = await store.listPendingInvitations();

    await store.acceptInvitation(invitation.id);

    expect((await store.listMembers('example-org/kickoff-notes')).map((member) => member.login)).toEqual(['ada-example']);
  });

  it('lists the repositories the member can reach by name, with their access: projects too, but no archived one', async () => {
    const store = createMemoryStore({
      seed: {
        repositories: [
          { repository: { owner: 'example-org', name: 'zebra' }, permission: 'read', issuesEnabled: true },
          { repository: { owner: 'example-org', name: 'alpha' }, permission: 'write', issuesEnabled: true },
        ],
      },
    });
    await store.createProject({ connectRepository: { owner: 'example-org', name: 'alpha' } });
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'grilling-demo' } });
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'closed-demo' } });
    await store.archiveProject('example-org/closed-demo');

    expect(await store.listRepositories()).toEqual([
      { repository: { owner: 'example-org', name: 'alpha' }, permission: 'write' },
      { repository: { owner: 'example-org', name: 'grilling-demo' }, permission: 'admin' },
      { repository: { owner: 'example-org', name: 'zebra' }, permission: 'read' },
    ]);
  });

  it('gives the creator of a new repository admin and a connected repository its own permission', async () => {
    const store = createMemoryStore();
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'grilling-demo' } });
    await store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' } });

    expect(await store.viewerPermission(PROJECT)).toBe('admin');
    expect(await store.viewerPermission('example-org/team-code')).toBe('write');
  });
});

describe('in-memory store: projects', () => {
  it('creates a project in a new repository with the default structure and the creator as its member', async () => {
    const store = createMemoryStore();

    const project = await store.createProject({ newRepository: { organisation: 'example-org', name: 'grilling-demo' } });

    expect(project).toMatchObject({
      id: PROJECT,
      name: 'grilling-demo',
      repository: { owner: 'example-org', name: 'grilling-demo' },
      structure: DEFAULT_PRD_STRUCTURE,
      archived: false,
    });
    expect(project.members.map((member) => member.login)).toEqual(['ada-example']);
    expect(await store.getProject(PROJECT)).toEqual(project);
    expect(await store.listProjects()).toEqual([project]);
  });

  it('keeps a chosen structure instead of the default', async () => {
    const store = createMemoryStore();
    const structure = { sections: [{ name: 'Problem', note: 'What hurts' }] };

    const project = await store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' }, structure });

    expect(project.structure).toEqual(structure);
  });

  it('opens the existing project when a connected repository already holds one', async () => {
    const store = createMemoryStore();
    const first = await store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' } });

    const again = await store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' } });

    expect(again).toEqual(first);
    expect(await store.listProjects()).toHaveLength(1);
  });

  it.each([
    ['an organisation the member is not in', { newRepository: { organisation: 'elsewhere', name: 'demo' } }, 'invalid'],
    ['an empty repository name', { newRepository: { organisation: 'example-org', name: '' } }, 'invalid'],
    ['a repository name with a space', { newRepository: { organisation: 'example-org', name: 'my demo' } }, 'invalid'],
    ['a repository name with a slash', { newRepository: { organisation: 'example-org', name: 'a/b' } }, 'invalid'],
    ['a repository that already exists', { newRepository: { organisation: 'example-org', name: 'team-code' } }, 'conflict'],
    ['an unknown repository to connect', { connectRepository: { owner: 'example-org', name: 'missing' } }, 'not-found'],
    ['a repository with read access only', { connectRepository: { owner: 'example-org', name: 'read-only' } }, 'forbidden'],
    ['a repository with issues turned off', { connectRepository: { owner: 'example-org', name: 'no-issues' } }, 'invalid'],
  ] as const)('refuses to create a project from %s', async (_case, input, kind) => {
    const store = createMemoryStore({
      seed: {
        repositories: [
          { repository: { owner: 'example-org', name: 'team-code' }, permission: 'write', issuesEnabled: true },
          { repository: { owner: 'example-org', name: 'read-only' }, permission: 'read', issuesEnabled: true },
          { repository: { owner: 'example-org', name: 'no-issues' }, permission: 'admin', issuesEnabled: false },
        ],
      },
    });

    expect(await refusal(store.createProject(input))).toBe(kind);
  });

  it('archives a project so nothing can change, and unarchiving reopens it', async () => {
    const { store, ticket } = await projectWithTicket();

    await store.archiveProject(PROJECT);

    expect((await store.getProject(PROJECT)).archived).toBe(true);
    expect(await store.getTicket(ticket)).toMatchObject({ title: 'Login flow' });
    expect(await refusal(store.updateTicket(ticket, { title: 'Changed' }))).toBe('read-only');
    await store.unarchiveProject(PROJECT);
    await expect(store.updateTicket(ticket, { title: 'Changed' })).resolves.toMatchObject({ title: 'Changed' });
  });

  it.each(['archiveProject', 'unarchiveProject'] as const)('refuses %s to a member without admin', async (method) => {
    const store = createMemoryStore();
    await store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' } });

    expect(await refusal(store[method]('example-org/team-code'))).toBe('forbidden');
  });

  it('returns the project folder and lists recent projects, last opened first', async () => {
    const { now, advance } = clock();
    const store = createMemoryStore({ now });
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'grilling-demo' } });
    await store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' } });

    expect(await store.openProjectFolder(PROJECT)).toBe('/memory/Grillo/example-org/grilling-demo');
    advance(60_000);
    await store.openProjectFolder('example-org/team-code');

    expect(await store.listRecentProjects()).toEqual([
      { project: 'example-org/team-code', lastOpened: '2026-10-24T09:16:00.000Z' },
      { project: PROJECT, lastOpened: '2026-10-24T09:15:00.000Z' },
    ]);
  });

  it.each([
    ['getProject', (store: Store) => store.getProject('example-org/missing')],
    ['getMap', (store: Store) => store.getMap('example-org/missing')],
    ['listTickets', (store: Store) => store.listTickets('example-org/missing')],
    ['openProjectFolder', (store: Store) => store.openProjectFolder('example-org/missing')],
  ])('refuses %s for a project that does not exist', async (_method, call) => {
    expect(await refusal(call(createMemoryStore()))).toBe('not-found');
  });
});

describe('in-memory store: members', () => {
  it('adds, reads, updates and removes a member line', async () => {
    const { store } = await projectWithTicket();

    expect(await store.getMember(PROJECT, OTHER)).toEqual({
      login: OTHER,
      name: null,
      email: null,
      role: 'product owner',
      domains: ['product'],
    });
    await store.updateMember(PROJECT, OTHER, { domains: ['product', 'design'] });
    expect((await store.getMember(PROJECT, OTHER)).domains).toEqual(['product', 'design']);
    await store.removeMember(PROJECT, OTHER);
    expect((await store.listMembers(PROJECT)).map((member) => member.login)).toEqual(['ada-example']);
  });

  it.each([
    ['an empty login', '', 'invalid'],
    ['a login already a member', OTHER, 'conflict'],
  ] as const)('refuses to add %s', async (_case, login, kind) => {
    const { store } = await projectWithTicket();

    expect(await refusal(store.addMember(PROJECT, { login, role: '', domains: [] }))).toBe(kind);
  });

  it('refuses inviting or removing members without admin', async () => {
    const store = createMemoryStore();
    await store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' } });

    expect(await refusal(store.addMember('example-org/team-code', { login: OTHER, role: '', domains: [] }))).toBe('forbidden');
    expect(await refusal(store.removeMember('example-org/team-code', 'ada-example'))).toBe('forbidden');
  });
});

describe('in-memory store: the map', () => {
  it('creates one map per project and updates its sections', async () => {
    const { store } = await projectWithTicket();

    const updated = await store.updateMap(PROJECT, { fog: ['Pricing is unclear'], outOfScope: ['Mobile app'] });

    expect(updated).toEqual({
      number: 1,
      destination: 'A PRD',
      notes: '',
      settled: [],
      fog: ['Pricing is unclear'],
      outOfScope: ['Mobile app'],
    });
    expect(await store.getMap(PROJECT)).toEqual(updated);
    expect(await refusal(store.createMap(PROJECT, { destination: '', notes: '', fog: [], outOfScope: [] }))).toBe('conflict');
  });

  it('refuses a ticket before the map exists', async () => {
    const store = createMemoryStore();
    await store.createProject({ newRepository: { organisation: 'example-org', name: 'grilling-demo' } });

    expect(await refusal(store.getMap(PROJECT))).toBe('not-found');
    expect(await refusal(store.createTicket(PROJECT, newTicket()))).toBe('not-found');
  });
});

describe('in-memory store: tickets', () => {
  it('creates a ticket in the pool with Q<issue>.<k> question codes', async () => {
    const { store, ticket } = await projectWithTicket();

    expect(await store.getTicket(ticket)).toEqual({
      id: { project: PROJECT, number: 2 },
      title: 'Login flow',
      question: 'How do members sign in?',
      whyItMatters: 'Every screen needs a member',
      assumptions: ['GitHub accounts exist'],
      kind: 'grilling',
      domains: [],
      noDomain: false,
      blockers: [],
      assignee: null,
      state: 'open',
      duplicateOf: null,
      questions: [
        { code: 'Q2.1', text: 'Which provider?', answered: false },
        { code: 'Q2.2', text: 'Is single sign-on needed?', answered: false },
      ],
    });
  });

  it('updates tags and blockers', async () => {
    const { store, ticket } = await projectWithTicket();
    const other = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));

    const updated = await store.updateTicket(ticket, { domains: ['platform', 'product'], blockers: [other.id.number] });

    expect(updated).toMatchObject({ domains: ['platform', 'product'], blockers: [3] });
  });

  it.each([
    ['"no domain" together with a domain', { noDomain: true, domains: ['platform'] }],
    ['a domain no member declared', { domains: ['finance'] }],
    ['a blocker that does not exist', { blockers: [99] }],
    ['the ticket blocking itself', { blockers: [2] }],
  ])('refuses to tag or block with %s', async (_case, patch) => {
    const { store, ticket } = await projectWithTicket();

    expect(await refusal(store.updateTicket(ticket, patch))).toBe('invalid');
  });

  it('sets tags by hand, "no domain" included, and untags a ticket handed back to the tagging round', async () => {
    const { store, ticket } = await projectWithTicket();

    await expect(store.tagTicketByHand(ticket, { domains: ['platform'], noDomain: false })).resolves.toMatchObject({ domains: ['platform'], noDomain: false });
    await expect(store.tagTicketByHand(ticket, { domains: [], noDomain: true })).resolves.toMatchObject({ domains: [], noDomain: true });
    await expect(store.tagTicketByHand(ticket, { domains: [], noDomain: false })).resolves.toMatchObject({ domains: [], noDomain: false });
    expect(await refusal(store.tagTicketByHand(ticket, { domains: ['finance'], noDomain: false }))).toBe('invalid');
    expect(await refusal(store.tagTicketByHand(ticket, { domains: ['platform'], noDomain: true }))).toBe('invalid');
  });

  it('lists the member own tickets first and keeps them through every domain filter, with "no domain" kept', async () => {
    const { store, ticket } = await projectWithTicket();
    const product = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    const anyone = await store.createTicket(PROJECT, newTicket({ title: 'Glossary' }));
    const mine = await store.createTicket(PROJECT, newTicket({ title: 'Hosting' }));
    await store.updateTicket(product.id, { domains: ['product'] });
    await store.updateTicket(anyone.id, { noDomain: true });
    await store.claimTicket(mine.id);
    await store.closeTicket(ticket);

    const titles = async (filter?: Parameters<Store['listTickets']>[1]) =>
      (await store.listTickets(PROJECT, filter)).map((entry) => entry.title);

    expect(await titles()).toEqual(['Hosting', 'Login flow', 'Pricing', 'Glossary']);
    expect(await titles({ state: 'open' })).toEqual(['Hosting', 'Pricing', 'Glossary']);
    expect(await titles({ domains: ['product'] })).toEqual(['Hosting', 'Pricing', 'Glossary']);
    expect(await titles({ domains: ['platform'] })).toEqual(['Hosting', 'Glossary']);
  });

  it('reports the map done only when no ticket is open and no fog is left', async () => {
    const { store, ticket } = await projectWithTicket();
    await store.updateMap(PROJECT, { fog: ['Pricing is unclear'] });

    expect(await store.closeTicket(ticket)).toEqual({ mapDone: false });
    await store.reopenTicket(ticket);
    await store.updateMap(PROJECT, { fog: [] });
    expect(await store.closeTicket(ticket)).toEqual({ mapDone: true });
  });

  it('merges a ticket by closing it as a duplicate with a decision pointing at the other', async () => {
    const { store, ticket } = await projectWithTicket();
    const into = await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));

    expect(await store.mergeTicket(ticket, into.id)).toEqual({ mapDone: false });

    expect(await store.getTicket(ticket)).toMatchObject({ state: 'closed', duplicateOf: 3 });
    expect((await store.listDecisions(ticket)).map((decision) => decision.text)).toEqual(['Merged into #3']);
    expect((await store.getMap(PROJECT)).settled).toEqual([{ ticket: 2, gist: 'Merged into #3' }]);
  });

  it.each([
    ['itself', 2],
    ['a ticket that does not exist', 99],
  ])('refuses to merge a ticket into %s', async (_case, number) => {
    const { store, ticket } = await projectWithTicket();

    expect(await refusal(store.mergeTicket(ticket, { project: PROJECT, number }))).toBe('invalid');
  });

  it('reopens a closed ticket', async () => {
    const { store, ticket } = await projectWithTicket();
    await store.closeTicket(ticket);

    await expect(store.reopenTicket(ticket)).resolves.toMatchObject({ state: 'open', duplicateOf: null });
  });

  it('puts the gist line of the latest decision back when a reopened ticket is closed again', async () => {
    const { store, ticket } = await projectWithTicket();
    await store.createDecision(ticket, { text: 'GitHub', gist: 'GitHub first', sources: [], via: null });
    await store.createDecision(ticket, { text: 'GitHub only', gist: 'GitHub only', sources: [], via: null });
    await store.closeTicket(ticket);
    await store.reopenTicket(ticket);

    await store.closeTicket(ticket);

    expect((await store.getMap(PROJECT)).settled).toEqual([{ ticket: 2, gist: 'GitHub only' }]);
  });

  it('reads duplicateOf from the merge decision while the ticket is closed, also when closed again', async () => {
    const { store, ticket } = await projectWithTicket();
    const into = await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));
    await store.mergeTicket(ticket, into.id);
    expect((await store.reopenTicket(ticket)).duplicateOf).toBeNull();

    await store.closeTicket(ticket);

    expect(await store.getTicket(ticket)).toMatchObject({ state: 'closed', duplicateOf: 3 });
  });

  it('checks only the domains an edit sets, so an edit keeps a tag whose last declarer left', async () => {
    const { store, ticket } = await projectWithTicket();
    await store.updateTicket(ticket, { domains: ['product'] });
    await store.removeMember(PROJECT, OTHER);

    await expect(store.updateTicket(ticket, { title: 'Sign-in flow' })).resolves.toMatchObject({ domains: ['product'] });
    expect(await refusal(store.updateTicket(ticket, { domains: ['product'] }))).toBe('invalid');
  });

  it('takes a reopened ticket off the settled list of the map', async () => {
    const { store, ticket } = await projectWithTicket();
    const into = await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));
    await store.createDecision(into.id, { text: 'GitHub', gist: 'Sign in with GitHub', sources: [], via: null });
    await store.mergeTicket(ticket, into.id);

    await store.reopenTicket(ticket);

    expect((await store.getMap(PROJECT)).settled).toEqual([{ ticket: 3, gist: 'Sign in with GitHub' }]);
  });
});

describe('in-memory store: map bookkeeping', () => {
  const decide = (store: Store, ticket: TicketId, gist: string) => store.createDecision(ticket, { text: gist, gist, sources: [], via: null });
  const settled = async (store: Store) => (await store.getMap(PROJECT)).settled;

  it('keeps one settled line per ticket, holding the latest gist, after two decisions or a decision then a merge', async () => {
    const { store, ticket } = await projectWithTicket();
    const second = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    const into = await store.createTicket(PROJECT, newTicket({ title: 'Hosting' }));

    await decide(store, ticket, 'GitHub first');
    await decide(store, ticket, 'GitHub only');
    await store.closeTicket(ticket);
    await decide(store, second.id, 'Free for all');
    await store.mergeTicket(second.id, into.id);

    expect(await settled(store)).toEqual([
      { ticket: 2, gist: 'GitHub only' },
      { ticket: 3, gist: 'Merged into #4' },
    ]);
  });

  it('follows only the latest decision on the map when decisions are edited or deleted', async () => {
    const { store, ticket } = await projectWithTicket();
    const first = await decide(store, ticket, 'Same words');
    const latest = await decide(store, ticket, 'Same words');

    await store.updateDecision(ticket, first.id, { gist: 'An older thought' });
    expect(await settled(store)).toEqual([{ ticket: 2, gist: 'Same words' }]);
    await store.updateDecision(ticket, latest.id, { gist: 'GitHub only' });
    expect(await settled(store)).toEqual([{ ticket: 2, gist: 'GitHub only' }]);
    await store.deleteDecision(ticket, latest.id);
    expect(await settled(store)).toEqual([{ ticket: 2, gist: 'An older thought' }]);
    await store.deleteDecision(ticket, first.id);
    expect(await settled(store)).toEqual([]);
  });

  it('does not read a merge that was undone and later decided on its own as a duplicate', async () => {
    const { store, ticket } = await projectWithTicket();
    const into = await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));
    await store.mergeTicket(ticket, into.id);
    await store.reopenTicket(ticket);
    await decide(store, ticket, 'GitHub only');

    await store.closeTicket(ticket);

    expect(await store.getTicket(ticket)).toMatchObject({ state: 'closed', duplicateOf: null });
    expect(await settled(store)).toEqual([{ ticket: 2, gist: 'GitHub only' }]);
  });

  it.each([
    ['a decision', async (store: Store, ticket: TicketId) => void (await decide(store, ticket, 'GitHub only'))],
    ['a merge that was undone', async (store: Store, ticket: TicketId) => {
      const into = await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));
      await store.mergeTicket(ticket, into.id);
      await store.reopenTicket(ticket);
    }],
  ])('lists a ticket closed as out of scope only under Out of scope, even after %s', async (_case, before) => {
    const { store, ticket } = await projectWithTicket();
    await before(store, ticket);

    await store.updateMap(PROJECT, { outOfScope: ['Login flow: beyond this PRD (#2)'] });
    await store.closeTicket(ticket);

    expect(await store.getMap(PROJECT)).toMatchObject({ settled: [], outOfScope: ['Login flow: beyond this PRD (#2)'] });
  });

  it('takes a reopened ticket off Out of scope too, so a decision on it settles it again', async () => {
    const { store, ticket } = await projectWithTicket();
    await store.updateMap(PROJECT, { outOfScope: ['Mobile app', 'Login flow: beyond this PRD (#2)'] });
    await store.closeTicket(ticket);

    await store.reopenTicket(ticket);
    await decide(store, ticket, 'GitHub only');
    await store.closeTicket(ticket);

    expect(await store.getMap(PROJECT)).toMatchObject({ settled: [{ ticket: 2, gist: 'GitHub only' }], outOfScope: ['Mobile app'] });
  });

  it('reports map done when updateMap takes the last fog line off with no open ticket, and only then', async () => {
    const { store, ticket } = await projectWithTicket();
    await store.updateMap(PROJECT, { fog: ['Pricing is unclear', 'Hosting is unclear'] });
    await store.closeTicket(ticket);

    expect(await store.updateMap(PROJECT, { fog: ['Hosting is unclear'] })).not.toHaveProperty('mapDone');
    expect(await store.updateMap(PROJECT, { fog: [] })).toMatchObject({ fog: [], mapDone: true });
    expect(await store.getMap(PROJECT)).not.toHaveProperty('mapDone');
    expect(await store.updateMap(PROJECT, { notes: 'Done already' })).not.toHaveProperty('mapDone');
    expect(await store.updateMap(PROJECT, { fog: [] })).not.toHaveProperty('mapDone');
  });

  it('does not report map done when updateMap takes the last fog line off while a ticket is open', async () => {
    const { store } = await projectWithTicket();
    await store.updateMap(PROJECT, { fog: ['Pricing is unclear'] });

    expect(await store.updateMap(PROJECT, { fog: [] })).not.toHaveProperty('mapDone');
  });
});

describe('in-memory store: taking, sending and releasing tickets', () => {
  it('claims a ticket for the member, and claiming it again keeps it', async () => {
    const { store, ticket } = await projectWithTicket();

    expect((await store.claimTicket(ticket)).assignee).toBe('ada-example');
    expect((await store.claimTicket(ticket)).assignee).toBe('ada-example');
  });

  it.each(['claimTicket', 'sendTicket'] as const)('refuses %s when another member holds the ticket', async (method) => {
    const { store, ticket } = await projectWithTicket();
    await store.addMember(PROJECT, { login: 'cy-example', role: '', domains: [] });
    await store.sendTicket(ticket, 'cy-example');

    expect(await refusal(store[method](ticket, OTHER))).toBe('conflict');
  });

  it('sends a ticket to a member, reassigns it while unanswered, and releases it to the pool', async () => {
    const { store, ticket } = await projectWithTicket();

    expect((await store.sendTicket(ticket, OTHER)).assignee).toBe(OTHER);
    expect((await store.reassignTicket(ticket, 'ada-example')).assignee).toBe('ada-example');
    const released = await store.releaseTicket(ticket);

    expect(released.assignee).toBeNull();
    expect(released.questions.map((question) => question.code)).toEqual(['Q2.1', 'Q2.2']);
  });

  it('refuses to reassign a ticket that has an answer', async () => {
    const { store, ticket } = await projectWithTicket();
    await store.sendTicket(ticket, OTHER);
    await store.createAnswer(ticket, { question: 'Q2.1', text: 'GitHub', sources: [], via: null, fromComment: null });

    expect(await refusal(store.reassignTicket(ticket, 'ada-example'))).toBe('conflict');
  });

  it.each([
    ['send to someone who is not a member', (store: Store, ticket: TicketId) => store.sendTicket(ticket, 'stranger')],
    ['claim a closed ticket', async (store: Store, ticket: TicketId) => {
      await store.closeTicket(ticket);
      return store.claimTicket(ticket);
    }],
  ])('refuses to %s', async (_case, call) => {
    const { store, ticket } = await projectWithTicket();

    expect(await refusal(call(store, ticket))).toBe('invalid');
  });
});

describe('in-memory store: questions', () => {
  it('adds, edits and removes questions without ever reusing a code', async () => {
    const { store, ticket } = await projectWithTicket();

    await store.removeQuestion(ticket, 'Q2.2');
    await store.addQuestion(ticket, 'Who hosts it?');
    const updated = await store.updateQuestion(ticket, 'Q2.1', 'Which sign-in provider?');

    expect(updated.questions).toEqual([
      { code: 'Q2.1', text: 'Which sign-in provider?', answered: false },
      { code: 'Q2.3', text: 'Who hosts it?', answered: false },
    ]);
  });

  it('refuses to edit an unknown question or remove an answered one', async () => {
    const { store, ticket } = await projectWithTicket();
    await store.createAnswer(ticket, { question: 'Q2.1', text: 'GitHub', sources: [], via: null, fromComment: null });

    expect(await refusal(store.updateQuestion(ticket, 'Q2.9', 'text'))).toBe('invalid');
    expect(await refusal(store.removeQuestion(ticket, 'Q2.1'))).toBe('conflict');
  });
});

describe('in-memory store: answers, discussions and decisions', () => {
  it('records an answer with who, when and sources, marks its question answered, and edits and deletes it', async () => {
    const { store, ticket } = await projectWithTicket();

    const answer = await store.createAnswer(ticket, {
      question: 'Q2.1',
      text: 'GitHub sign-in',
      sources: ['S1'],
      via: 'generic-agent',
      fromComment: null,
    });

    expect(answer).toEqual({
      id: answer.id,
      ticket,
      question: 'Q2.1',
      text: 'GitHub sign-in',
      who: 'ada-example',
      when: '2026-10-24T09:15:00.000Z',
      sources: ['S1'],
      via: 'generic-agent',
    });
    expect((await store.getTicket(ticket)).questions[0].answered).toBe(true);
    await store.updateAnswer(ticket, answer.id, 'GitHub sign-in only');
    expect((await store.listAnswers(ticket)).map((entry) => entry.text)).toEqual(['GitHub sign-in only']);
    await store.deleteAnswer(ticket, answer.id);
    expect((await store.getTicket(ticket)).questions[0].answered).toBe(false);
  });

  it('turns a member comment from GitHub into an answer once, and undoing the answer puts it back', async () => {
    const { store, ticket } = await projectWithTicket();
    const comment = store.addMemberComment(ticket, OTHER, 'Use GitHub, nothing else');
    expect(await store.listPickupComments(ticket)).toEqual([comment]);

    const answer = await store.createAnswer(ticket, {
      question: 'Q2.1',
      text: 'GitHub only',
      sources: [],
      via: 'github',
      fromComment: comment.id,
    });

    expect(await store.listPickupComments(ticket)).toEqual([]);
    const again = { question: 'Q2.1', text: 'again', sources: [], via: 'github' as const, fromComment: comment.id };
    expect(await refusal(store.createAnswer(ticket, again))).toBe('invalid');
    await store.deleteAnswer(ticket, answer.id);
    expect(await store.listPickupComments(ticket)).toEqual([comment]);
  });

  it('lists the waiting comments of every open ticket of the project in one call, in ticket order', async () => {
    const { store, ticket } = await projectWithTicket();
    const other = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    const closed = await store.createTicket(PROJECT, newTicket({ title: 'Hosting' }));
    const later = store.addMemberComment(other.id, OTHER, 'Free for all');
    const first = store.addMemberComment(ticket, OTHER, 'Use GitHub');
    store.addMemberComment(closed.id, OTHER, 'On a closed ticket');
    await store.closeTicket(closed.id);

    expect(await store.listProjectPickupComments(PROJECT)).toEqual([first, later]);
  });

  it.each([
    ['an answer', (store: Store, ticket: TicketId) =>
      store.createAnswer(ticket, { question: 'Q2.9', text: 'x', sources: [], via: null, fromComment: null })],
    ['a discussion', (store: Store, ticket: TicketId) =>
      store.createDiscussion(ticket, { question: 'Q2.9', transcript: 'x', sessionFile: null, sources: [], via: null })],
  ])('refuses %s for a question the ticket does not have', async (_case, call) => {
    const { store, ticket } = await projectWithTicket();

    expect(await refusal(call(store, ticket))).toBe('invalid');
  });

  it('keeps a discussion word for word with its session file, and edits and deletes it', async () => {
    const { store, ticket } = await projectWithTicket();

    const discussion = await store.createDiscussion(ticket, {
      question: 'Q2.1',
      transcript: 'We talked about GitHub.',
      sessionFile: '.grillo/sessions/2026-10-24-091500.md',
      sources: ['S2'],
      via: null,
    });
    await store.updateDiscussion(ticket, discussion.id, 'We talked about GitHub at length.');

    expect(await store.listDiscussions(ticket)).toEqual([
      { ...discussion, transcript: 'We talked about GitHub at length.' },
    ]);
    await store.deleteDiscussion(ticket, discussion.id);
    expect(await store.listDiscussions(ticket)).toEqual([]);
  });

  it('records a decision with its gist line on the map, and editing or deleting it follows on the map', async () => {
    const { store, ticket } = await projectWithTicket();

    const decision = await store.createDecision(ticket, { text: 'GitHub sign-in only', gist: 'GitHub sign-in', sources: [], via: null });
    expect((await store.getMap(PROJECT)).settled).toEqual([{ ticket: 2, gist: 'GitHub sign-in' }]);
    await store.updateDecision(ticket, decision.id, { gist: 'Sign in with GitHub' });
    expect((await store.getMap(PROJECT)).settled).toEqual([{ ticket: 2, gist: 'Sign in with GitHub' }]);

    await store.deleteDecision(ticket, decision.id);

    expect(await store.listDecisions(ticket)).toEqual([]);
    expect((await store.getMap(PROJECT)).settled).toEqual([]);
  });

  it.each([
    ['updateAnswer', (store: Store, ticket: TicketId) => store.updateAnswer(ticket, 'c999', 'x')],
    ['deleteDiscussion', (store: Store, ticket: TicketId) => store.deleteDiscussion(ticket, 'c999')],
    ['deleteDecision', (store: Store, ticket: TicketId) => store.deleteDecision(ticket, 'c999')],
    ['getTicket', (store: Store) => store.getTicket({ project: PROJECT, number: 99 })],
  ])('refuses %s for a record that does not exist', async (_case, call) => {
    const { store, ticket } = await projectWithTicket();

    expect(await refusal(call(store, ticket))).toBe('not-found');
  });
});

describe('in-memory store: grilling sessions', () => {
  it('starts a session named by date and time, then records presence, consent and transcript', async () => {
    const { store, advance } = await projectWithTicket();

    const created = await store.createSession(PROJECT, { present: ['ada-example'] });
    advance(60_000);
    await store.updateSession(PROJECT, created.id, { present: ['ada-example', OTHER], consent: true, transcript: 'Hello.' });

    expect(await store.getSession(PROJECT, '2026-10-24-091500')).toEqual({
      id: '2026-10-24-091500',
      date: '2026-10-24T09:15:00.000Z',
      present: ['ada-example', OTHER],
      consent: { by: 'ada-example', at: '2026-10-24T09:16:00.000Z' },
      transcript: 'Hello.',
    });
    expect(await store.listSessions(PROJECT)).toHaveLength(1);
  });

  it('refuses a session with someone who is not a member, or a second one in the same second', async () => {
    const { store } = await projectWithTicket();

    expect(await refusal(store.createSession(PROJECT, { present: ['stranger'] }))).toBe('invalid');
    await store.createSession(PROJECT, { present: [] });
    expect(await refusal(store.createSession(PROJECT, { present: [] }))).toBe('conflict');
  });
});

describe('in-memory store: sources, structure, PRD versions and scores', () => {
  it('numbers sources S1, S2 in order and reads them back by code', async () => {
    const { store } = await projectWithTicket();
    const input = { kind: 'pasted-text', who: 'Ben Example', when: '2026-10-23T10:00:00.000Z', where: 'email', text: 'Idea' } as const;

    await store.createSource(PROJECT, input);
    const second = await store.createSource(PROJECT, { ...input, kind: 'meeting' });

    expect(second).toEqual({ ...input, kind: 'meeting', code: 'S2' });
    expect(await store.getSource(PROJECT, 'S2')).toEqual(second);
    expect((await store.listSources(PROJECT)).map((source) => source.code)).toEqual(['S1', 'S2']);
    expect(await refusal(store.getSource(PROJECT, 'S9'))).toBe('not-found');
  });

  it('replaces the PRD structure', async () => {
    const { store } = await projectWithTicket();
    const structure = { sections: [{ name: 'Problem', note: 'What hurts' }, { name: 'Flows', note: 'Steps' }] };

    await store.updateStructure(PROJECT, structure);

    expect(await store.getStructure(PROJECT)).toEqual(structure);
    expect((await store.getProject(PROJECT)).structure).toEqual(structure);
  });

  it.each([
    ['no sections', []],
    ['a section with no name', [{ name: ' ', note: '' }]],
    ['two sections with one name', [{ name: 'Problem', note: '' }, { name: 'Problem', note: '' }]],
  ])('refuses a structure with %s', async (_case, sections) => {
    const { store } = await projectWithTicket();

    expect(await refusal(store.updateStructure(PROJECT, { sections }))).toBe('invalid');
  });

  it('numbers and dates PRD versions and keeps every one', async () => {
    const { store, advance } = await projectWithTicket();

    await store.createPrdVersion(PROJECT, { body: '# PRD v1', appendix: 'S1' });
    advance(60_000);
    const second = await store.createPrdVersion(PROJECT, { body: '# PRD v2', appendix: 'S1, S2' });

    expect(second).toEqual({ number: 2, date: '2026-10-24T09:16:00.000Z', body: '# PRD v2', appendix: 'S1, S2', score: null });
    expect(await store.getPrdVersion(PROJECT, 2)).toEqual(second);
    expect((await store.listPrdVersions(PROJECT)).map((version) => version.number)).toEqual([1, 2]);
    expect(await refusal(store.getPrdVersion(PROJECT, 3))).toBe('not-found');
  });

  it('stores a score with its PRD version, replaces it on a rerun, and clears it', async () => {
    const { store } = await projectWithTicket();
    await store.createPrdVersion(PROJECT, { body: '# PRD', appendix: '' });
    const score: Score = {
      overall: 6.5,
      criteria: [{ name: 'Clear', mark: 7, comment: 'Mostly plain words' }],
      sections: [{ name: 'Problem', mark: 6, comment: 'Outcomes are vague' }],
    };

    await store.setScore(PROJECT, 1, score);
    expect(await store.getScore(PROJECT, 1)).toEqual(score);
    expect((await store.getPrdVersion(PROJECT, 1)).score).toEqual(score);
    await store.setScore(PROJECT, 1, { ...score, overall: 8 });
    expect((await store.getScore(PROJECT, 1))?.overall).toBe(8);
    await store.setScore(PROJECT, 1, null);
    expect(await store.getScore(PROJECT, 1)).toBeNull();
  });

  it.each([
    ['an overall mark above 10', { overall: 11, criteria: [], sections: [] }],
    ['a negative criterion mark', { overall: 5, criteria: [{ name: 'Clear', mark: -1, comment: '' }], sections: [] }],
    ['a section mark that is not a number', { overall: 5, criteria: [], sections: [{ name: 'Problem', mark: Number.NaN, comment: '' }] }],
  ])('refuses a score with %s', async (_case, score) => {
    const { store } = await projectWithTicket();
    await store.createPrdVersion(PROJECT, { body: '# PRD', appendix: '' });

    expect(await refusal(store.setScore(PROJECT, 1, score))).toBe('invalid');
  });
});

describe('in-memory store: records handed out are copies', () => {
  it('ignores changes a caller makes to a record it was given', async () => {
    const { store, ticket } = await projectWithTicket();

    const read = await store.getTicket(ticket);
    read.questions.push({ code: 'Q2.9', text: 'sneaked in', answered: false });
    read.assumptions.length = 0;

    expect(await store.getTicket(ticket)).toMatchObject({ assumptions: ['GitHub accounts exist'] });
    expect((await store.getTicket(ticket)).questions).toHaveLength(2);
  });
});

describe('in-memory store: a project under the own account', () => {
  const OWN = 'ada-example/mine';

  it('creates a private or a public project under the signed-in account, whatever case its login is written in', async () => {
    const store = createMemoryStore();

    await store.createProject({ newRepository: { organisation: 'ada-example', name: 'mine' } });
    await store.createProject({ newRepository: { organisation: 'ADA-Example', name: 'open', visibility: 'public' } });

    expect(await store.viewerPermission(OWN)).toBe('admin');
    expect(await store.signedInLogin()).toBe('ada-example');
    expect((await store.listRepositories()).map(({ repository }) => repository.name)).toEqual(expect.arrayContaining(['mine', 'open']));
  });

  it.each([
    ['an organisation', 'example-org'],
    ['another person', 'ben-example'],
  ])('refuses a public repository owned by %s, creating nothing', async (_case, owner) => {
    const store = createMemoryStore();

    expect(await refusal(store.createProject({ newRepository: { organisation: owner, name: 'demo', visibility: 'public' } }))).toBe('forbidden');
    expect(await store.listProjects()).toEqual([]);
  });

  it('refuses a private repository under an owner that is neither the member nor one of their organisations', async () => {
    const store = createMemoryStore();

    expect(await refusal(store.createProject({ newRepository: { organisation: 'ben-example', name: 'demo' } }))).toBe('invalid');
  });

  it.each([['internal'], [''], [null]])('refuses %s as a visibility', async (visibility) => {
    const store = createMemoryStore();
    const input = { newRepository: { organisation: 'ada-example', name: 'mine', visibility } } as unknown as Parameters<typeof store.createProject>[0];

    expect(await refusal(store.createProject(input))).toBe('invalid');
  });

  it('keeps inviting, closing and reopening from a member who joined by invitation to a personal repository', async () => {
    const store = createMemoryStore({
      seed: { invitations: [{ id: 2, repository: { owner: 'ben-example', name: 'shared' }, inviter: 'ben-example', createdAt: '2026-10-20T09:00:00.000Z' }] },
    });
    await store.acceptInvitation(2);
    const project = 'ben-example/shared';

    expect(await store.viewerPermission(project)).toBe('write');
    expect(await refusal(store.addMember(project, { login: 'cy-example', role: '', domains: [] }))).toBe('forbidden');
    expect(await refusal(store.archiveProject(project))).toBe('forbidden');
    expect(await refusal(store.unarchiveProject(project))).toBe('forbidden');
  });
});
