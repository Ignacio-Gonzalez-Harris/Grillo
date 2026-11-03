import { describe, expect, it } from 'vitest';
import { createMemorySettings } from '../../memory/settings';
import { StoreError, type NewTicket, type Store, type StoreErrorKind } from '../../store';
import type { TicketId } from '../../types';
import { createIssuesStore } from '.';
import { formatComment, formatTagsByHand, parseTagsByHand } from './bodies';
import { createFakeIssues } from './fake-issues';

// Every test drives the store through the Store interface; the fake GitHub stands in for `gh`.
type IssuesStore = ReturnType<typeof createIssuesStore>;

const PROJECT = 'example-org/demo';
const OTHER = 'ben-example';
const START = new Date('2026-10-24T09:15:00.000Z');
const MEMBERS = [
  { login: 'ada-example', role: 'developer', domains: ['platform'] },
  { login: OTHER, role: 'product owner', domains: ['product'] },
];

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

function setup() {
  const github = createFakeIssues();
  const repository = github.addRepository(PROJECT, MEMBERS);
  const store = createIssuesStore({ gh: github.gh, settings: createMemorySettings(), now: () => START });
  const issue = (number: number) => repository.issues.get(number)!;
  const writes = () => github.calls.filter((call) => /--method (POST|PATCH|DELETE)/.test(call));
  return { github, repository, store, issue, writes };
}

/** A project with its map (issue 1) and one ticket (issue 2). */
async function projectWithTicket() {
  const context = setup();
  await context.store.createMap(PROJECT, { destination: 'A PRD', notes: '', fog: [], outOfScope: [] });
  const created = await context.store.createTicket(PROJECT, newTicket());
  return { ...context, ticket: created.id };
}

const plainAnswer = (question = 'Q2.1') => ({ question, text: 'GitHub', sources: [], via: null, fromComment: null });

describe('GitHub issues backend: the map', () => {
  it('creates one issue titled Map labelled wayfinder:map with the five sections, and updates them', async () => {
    const { store, issue } = setup();

    const created = await store.createMap(PROJECT, { destination: 'A PRD', notes: 'Kick-off', fog: [], outOfScope: [] });
    const updated = await store.updateMap(PROJECT, { fog: ['Pricing is unclear'], outOfScope: ['Mobile app'] });

    expect(created).toEqual({ number: 1, destination: 'A PRD', notes: 'Kick-off', settled: [], fog: [], outOfScope: [] });
    expect(issue(1)).toMatchObject({ title: 'Map', labels: ['wayfinder:map'] });
    expect(issue(1).body).toBe('### Destination\nA PRD\n\n### Notes\nKick-off\n\n### Settled\n\n### Fog\n- Pricing is unclear\n\n### Out of scope\n- Mobile app\n');
    expect(updated).toEqual({ number: 1, destination: 'A PRD', notes: 'Kick-off', settled: [], fog: ['Pricing is unclear'], outOfScope: ['Mobile app'] });
    expect(await store.getMap(PROJECT)).toEqual(updated);
    expect(await refusal(store.createMap(PROJECT, { destination: '', notes: '', fog: [], outOfScope: [] }))).toBe('conflict');
  });

  it('refuses the map and a ticket before the map exists', async () => {
    const { store } = setup();

    expect(await refusal(store.getMap(PROJECT))).toBe('not-found');
    expect(await refusal(store.createTicket(PROJECT, newTicket()))).toBe('not-found');
  });

  it('refuses a repository holding two map issues as a backend error', async () => {
    const { store, github } = setup();
    github.addIssue(PROJECT, { title: 'Map', labels: ['wayfinder:map'] });
    github.addIssue(PROJECT, { title: 'Map', labels: ['wayfinder:map'] });

    expect(await refusal(store.getMap(PROJECT))).toBe('backend');
  });

  it.each([
    ['a destination with a line that starts a section', { destination: 'A PRD\n### Notes' }],
    ['a destination starting with spaces and a section heading', { destination: '  ### Notes' }],
    ['a destination starting with a tab and a section heading', { destination: '\t### Notes' }],
    ['notes starting with a blank line and a section heading', { notes: '\n  ### Fog' }],
    ['an empty fog item', { fog: [''] }],
    ['a fog list that is not a list', { fog: 'Pricing' as unknown as string[] }],
  ])('refuses %s without writing anything', async (_case, patch) => {
    const { store, writes } = await projectWithTicket();
    const before = writes().length;

    expect(await refusal(store.updateMap(PROJECT, patch))).toBe('invalid');
    expect(writes()).toHaveLength(before);
    await expect(store.getMap(PROJECT)).resolves.toMatchObject({ destination: 'A PRD' });
  });

  it('keeps a fog item on one line', async () => {
    const { store } = await projectWithTicket();

    expect((await store.updateMap(PROJECT, { fog: ['Pricing\nis unclear'] })).fog).toEqual(['Pricing is unclear']);
  });
});

describe('GitHub issues backend: a closed project', () => {
  it('reads an archived project and refuses every change as read-only before writing anything', async () => {
    const { store, repository, writes, ticket } = await projectWithTicket();
    repository.archived = true;
    const before = writes().length;

    await expect(store.getMap(PROJECT)).resolves.toMatchObject({ number: 1 });
    await expect(store.getTicket(ticket)).resolves.toMatchObject({ title: 'Login flow' });
    expect(await refusal(store.updateMap(PROJECT, { fog: [] }))).toBe('read-only');
    expect(await refusal(store.createTicket(PROJECT, newTicket()))).toBe('read-only');
    expect(await refusal(store.claimTicket(ticket))).toBe('read-only');
    expect(await refusal(store.createAnswer(ticket, plainAnswer()))).toBe('read-only');
    expect(await refusal(store.closeTicket(ticket))).toBe('read-only');
    expect(writes()).toHaveLength(before);
  });
});

describe('GitHub issues backend: tickets', () => {
  it('creates a ticket as a native sub-issue of the map with its kind label and Q<issue>.<k> lines', async () => {
    const { store, issue, ticket } = await projectWithTicket();

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
    expect(issue(2).labels).toEqual(['wayfinder:grilling']);
    expect(issue(1).subIssues).toEqual([issue(2).id]);
    expect(issue(2).body).toBe(
      '### Question\nHow do members sign in?\n\n### Why it matters\nEvery screen needs a member\n\n### Assumptions\n- GitHub accounts exist\n\n' +
        '### Questions\n- Q2.1 Which provider?\n- Q2.2 Is single sign-on needed?\n\n### Blocked by\n',
    );
  });

  it('sets a new ticket blockers in both forms: the body section and the native relation', async () => {
    const { store, issue } = await projectWithTicket();

    const blocked = await store.createTicket(PROJECT, newTicket({ title: 'Pricing', kind: 'research', blockers: [2] }));

    expect(blocked.blockers).toEqual([2]);
    expect(issue(3).labels).toEqual(['wayfinder:research']);
    expect(issue(3).body).toContain('### Blocked by\n- #2\n');
    expect(issue(3).blockedBy).toEqual([issue(2).id]);
  });

  it('updates tags as domain labels, keeps labels Grillo does not own, and keeps native blockers in step', async () => {
    const { store, issue, ticket } = await projectWithTicket();
    const first = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    const second = await store.createTicket(PROJECT, newTicket({ title: 'Hosting' }));
    issue(2).labels.push('bug');
    await store.updateTicket(ticket, { blockers: [first.id.number] });

    const updated = await store.updateTicket(ticket, { domains: ['platform', 'product'], blockers: [second.id.number], kind: 'task' });

    expect(updated).toMatchObject({ domains: ['platform', 'product'], noDomain: false, blockers: [4], kind: 'task' });
    expect(issue(2).labels).toEqual(['bug', 'wayfinder:task', 'domain:platform', 'domain:product']);
    expect(issue(2).blockedBy).toEqual([issue(4).id]);
    expect(issue(2).body).toContain('### Blocked by\n- #4\n');
  });

  it('tags a ticket "no domain" with the domain:none label in place of its domains', async () => {
    const { store, issue, ticket } = await projectWithTicket();
    await store.updateTicket(ticket, { domains: ['platform'] });

    const updated = await store.updateTicket(ticket, { domains: [], noDomain: true });

    expect(updated).toMatchObject({ domains: [], noDomain: true });
    expect(issue(2).labels).toEqual(['wayfinder:grilling', 'domain:none']);
  });

  it.each([
    ['"no domain" together with a domain', { noDomain: true, domains: ['platform'] }],
    ['a domain no member declared', { domains: ['finance'] }],
    ['the domain name "none", which is the no-domain tag', { domains: ['none'] }],
    ['a blocker that does not exist', { blockers: [99] }],
    ['the map as a blocker', { blockers: [1] }],
    ['the ticket blocking itself', { blockers: [2] }],
    ['the same blocker twice', { blockers: [3, 3] }],
    ['an empty title', { title: '  ' }],
    ['a question text with a line that starts a section', { question: 'How?\n### Questions' }],
    ['a question text starting with spaces and a section heading', { question: '  ### Questions' }],
    ['a why-it-matters text starting with a tab and a section heading', { whyItMatters: '\t### Assumptions' }],
    ['an unknown kind', { kind: 'meeting' as never }],
  ])('refuses to update a ticket with %s without writing anything', async (_case, patch) => {
    const { store, ticket, writes } = await projectWithTicket();
    await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    const before = writes().length;

    expect(await refusal(store.updateTicket(ticket, patch))).toBe('invalid');
    expect(writes()).toHaveLength(before);
    await expect(store.listTickets(PROJECT)).resolves.toHaveLength(2);
  });

  it.each([
    ['a question starting with spaces and a section heading', { question: ' ### Context' }],
    ['a question starting with a tab and a section heading', { question: '\t### Context' }],
    ['a why-it-matters text with a section heading on a later line', { whyItMatters: 'Because\n### Questions' }],
  ])('refuses to create a ticket with %s without creating any issue', async (_case, fields) => {
    const { store, writes } = await projectWithTicket();
    const before = writes().length;

    expect(await refusal(store.createTicket(PROJECT, newTicket(fields)))).toBe('invalid');
    expect(writes()).toHaveLength(before);
    await expect(store.listTickets(PROJECT)).resolves.toHaveLength(1);
  });

  it('checks only the domains an edit sets, so an edit keeps a tag whose last declarer left', async () => {
    const { store, repository, ticket } = await projectWithTicket();
    await store.updateTicket(ticket, { domains: ['product'] });
    repository.files.set('.grillo/members.json', JSON.stringify([MEMBERS[0]]));

    await expect(store.updateTicket(ticket, { title: 'Sign-in flow' })).resolves.toMatchObject({ domains: ['product'] });
    expect(await refusal(store.updateTicket(ticket, { domains: ['product'] }))).toBe('invalid');
  });

  it('lists the member own tickets first and keeps them through every domain filter, with "no domain" kept', async () => {
    const { store, ticket } = await projectWithTicket();
    const product = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    const anyone = await store.createTicket(PROJECT, newTicket({ title: 'Glossary', kind: 'task' }));
    const mine = await store.createTicket(PROJECT, newTicket({ title: 'Hosting', kind: 'research' }));
    await store.updateTicket(product.id, { domains: ['product'] });
    await store.updateTicket(anyone.id, { noDomain: true });
    await store.claimTicket(mine.id);
    await store.closeTicket(ticket);

    const titles = async (filter?: Parameters<Store['listTickets']>[1]) => (await store.listTickets(PROJECT, filter)).map((entry) => entry.title);

    expect(await titles()).toEqual(['Hosting', 'Login flow', 'Pricing', 'Glossary']);
    expect(await titles({ state: 'open' })).toEqual(['Hosting', 'Pricing', 'Glossary']);
    expect(await titles({ domains: ['product'] })).toEqual(['Hosting', 'Pricing', 'Glossary']);
    expect(await titles({ domains: ['platform'] })).toEqual(['Hosting', 'Glossary']);
  });

  it('filters by any declared domain names, "none" and blank ones included, as the members file allows them', async () => {
    const { store } = await projectWithTicket();
    const anyone = await store.createTicket(PROJECT, newTicket({ title: 'Glossary' }));
    await store.updateTicket(anyone.id, { noDomain: true });
    const titles = async (domains: unknown) =>
      (await store.listTickets(PROJECT, { domains: domains as string[] })).map((entry) => entry.title);

    expect(await titles(['platform', 'none'])).toEqual(['Glossary']);
    expect(await titles(['platform', ''])).toEqual(['Glossary']);
    expect(await refusal(store.listTickets(PROJECT, { domains: 'platform' as unknown as string[] }))).toBe('invalid');
    expect(await refusal(store.listTickets(PROJECT, { domains: ['platform', 7] as unknown as string[] }))).toBe('invalid');
  });

  it('ignores issues that are no tickets: the map, an unlabelled issue and a pull request', async () => {
    const { store, github } = await projectWithTicket();
    github.addIssue(PROJECT, { title: 'A bug report', labels: ['bug'] });
    github.addIssue(PROJECT, { title: 'A pull request', labels: ['wayfinder:task'], pullRequest: true });

    expect((await store.listTickets(PROJECT)).map((entry) => entry.id.number)).toEqual([2]);
    expect(await refusal(store.getTicket({ project: PROJECT, number: 1 }))).toBe('not-found');
    expect(await refusal(store.getTicket({ project: PROJECT, number: 3 }))).toBe('not-found');
    expect(await refusal(store.getTicket({ project: PROJECT, number: 4 }))).toBe('not-found');
  });

  it('reports the map done only when no ticket is open and no fog is left', async () => {
    const { store, issue, ticket } = await projectWithTicket();
    await store.updateMap(PROJECT, { fog: ['Pricing is unclear'] });

    expect(await store.closeTicket(ticket)).toEqual({ mapDone: false });
    expect(issue(2)).toMatchObject({ state: 'closed', stateReason: 'completed' });
    await store.reopenTicket(ticket);
    await store.updateMap(PROJECT, { fog: [] });
    const other = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    expect(await store.closeTicket(ticket)).toEqual({ mapDone: false });
    expect(await store.closeTicket(other.id)).toEqual({ mapDone: true });
  });

  it('merges a ticket by closing it as a duplicate with a decision pointing at the other', async () => {
    const { store, issue, ticket } = await projectWithTicket();
    const into = await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));

    expect(await store.mergeTicket(ticket, into.id)).toEqual({ mapDone: false });

    expect(await store.getTicket(ticket)).toMatchObject({ state: 'closed', duplicateOf: 3 });
    expect(issue(2)).toMatchObject({ state: 'closed', stateReason: 'duplicate', duplicateIssueId: issue(3).id });
    expect((await store.listDecisions(ticket)).map((decision) => [decision.text, decision.gist])).toEqual([['Merged into #3', 'Merged into #3']]);
    expect((await store.getMap(PROJECT)).settled).toEqual([{ ticket: 2, gist: 'Merged into #3' }]);
  });

  it.each([
    ['itself', { project: PROJECT, number: 2 }],
    ['a ticket that does not exist', { project: PROJECT, number: 99 }],
    ['the map', { project: PROJECT, number: 1 }],
    ['a ticket of another project', { project: 'example-org/other', number: 3 }],
  ])('refuses to merge a ticket into %s', async (_case, into) => {
    const { store } = await projectWithTicket();
    await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));

    expect(await refusal(store.mergeTicket({ project: PROJECT, number: 2 }, into))).toBe('invalid');
  });

  it('refuses to merge into a closed ticket', async () => {
    const { store, ticket } = await projectWithTicket();
    const into = await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));
    await store.closeTicket(into.id);

    expect(await refusal(store.mergeTicket(ticket, into.id))).toBe('invalid');
  });

  it('reopens a closed ticket and takes its line off the settled list of the map', async () => {
    const { store, issue, ticket } = await projectWithTicket();
    const into = await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));
    await store.createDecision(into.id, { text: 'GitHub', gist: 'Sign in with GitHub', sources: [], via: null });
    await store.mergeTicket(ticket, into.id);

    await expect(store.reopenTicket(ticket)).resolves.toMatchObject({ state: 'open', duplicateOf: null });

    expect(issue(2)).toMatchObject({ state: 'open', stateReason: 'reopened' });
    expect((await store.getMap(PROJECT)).settled).toEqual([{ ticket: 3, gist: 'Sign in with GitHub' }]);
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
});

describe('GitHub issues backend: map bookkeeping', () => {
  const decide = (store: IssuesStore, ticket: TicketId, gist: string) => store.createDecision(ticket, { text: gist, gist, sources: [], via: null });
  const settled = async (store: IssuesStore) => (await store.getMap(PROJECT)).settled;

  it('keeps one settled line per ticket, holding the latest gist, after two decisions or a decision then a merge', async () => {
    const { store, issue, ticket } = await projectWithTicket();
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
    expect(issue(1).body).toContain('### Settled\n- #2 GitHub only\n- #3 Merged into #4\n');
  });

  it('collapses the several lines an older version left for a ticket into the one with the latest gist', async () => {
    const { store, issue, ticket } = await projectWithTicket();
    issue(1).body = issue(1).body!.replace('### Settled\n', '### Settled\n- #2 Old one\n- #9 Someone else\n- #2 Older one\n');

    await decide(store, ticket, 'GitHub only');

    expect(await settled(store)).toEqual([
      { ticket: 2, gist: 'GitHub only' },
      { ticket: 9, gist: 'Someone else' },
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
    ['a decision', async (store: IssuesStore, ticket: TicketId) => void (await decide(store, ticket, 'GitHub only'))],
    ['a merge that was undone', async (store: IssuesStore, ticket: TicketId) => {
      const into = await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));
      await store.mergeTicket(ticket, into.id);
      await store.reopenTicket(ticket);
    }],
  ])('lists a ticket closed as out of scope only under Out of scope, even after %s', async (_case, before) => {
    const { store, issue, ticket } = await projectWithTicket();
    await before(store, ticket);

    await store.updateMap(PROJECT, { outOfScope: ['Login flow: beyond this PRD (#2)'] });
    await store.closeTicket(ticket);

    expect(issue(1).body).toBe('### Destination\nA PRD\n\n### Notes\n\n### Settled\n\n### Fog\n\n### Out of scope\n- Login flow: beyond this PRD (#2)\n');
  });

  it.each([
    ['the screen form', 'Login flow: beyond this PRD (#2)', true],
    ['the skill form at the start', '#2 is beyond this PRD', true],
    ['after a colon', 'Beyond this PRD:#2', true],
    ['in brackets', 'Beyond this PRD [#2]', true],
    ['after an equals sign', 'ticket=#2', true],
    ['another ticket that starts with the same digits', 'Hosting (#21)', false],
    ['a ticket number followed by a letter', 'Beyond this PRD #2a', false],
    ['a double hash', 'Beyond this PRD ##2', false],
    ['a hash inside a word', 'Beyond this PRD, see issue#2', false],
    ['a plain number', 'Two weeks: 2 sprints', false],
  ])('reads an out-of-scope line naming a ticket: %s', async (_case, line, named) => {
    const { store, ticket } = await projectWithTicket();
    await decide(store, ticket, 'GitHub only');
    await store.updateMap(PROJECT, { outOfScope: [line] });

    await store.closeTicket(ticket);

    expect(await settled(store)).toEqual(named ? [] : [{ ticket: 2, gist: 'GitHub only' }]);
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

  it('keeps both settled lines when two laptops change the map body at once', async () => {
    const { github, store, ticket } = await projectWithTicket();
    const other = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    const laptop = createIssuesStore({ gh: github.gh, settings: createMemorySettings(), now: () => START });

    await Promise.all([decide(store, ticket, 'GitHub only'), decide(laptop, other.id, 'Free for all')]);

    expect((await settled(store)).toSorted((a, b) => a.ticket - b.ticket)).toEqual([
      { ticket: 2, gist: 'GitHub only' },
      { ticket: 3, gist: 'Free for all' },
    ]);
  });

  it('writes the line again when another laptop overwrites the map body just after this write', async () => {
    const { store, issue, ticket } = await projectWithTicket();
    const stale = issue(1).body;
    let body = stale;
    let writes = 0;
    Object.defineProperty(issue(1), 'body', {
      configurable: true,
      get: () => body,
      set: (written: string) => {
        writes += 1;
        // The first write is lost to the other laptop's older body; later writes stay.
        body = writes === 1 ? stale : written;
      },
    });

    await decide(store, ticket, 'GitHub only');

    expect(writes).toBe(2);
    expect(await settled(store)).toEqual([{ ticket: 2, gist: 'GitHub only' }]);
  });

  it('refuses as a conflict when a write never stays, after a few tries', async () => {
    const { store, issue } = await projectWithTicket();
    const stale = issue(1).body;
    let writes = 0;
    Object.defineProperty(issue(1), 'body', {
      configurable: true,
      get: () => stale,
      set: () => {
        writes += 1;
      },
    });

    expect(await refusal(store.updateMap(PROJECT, { notes: 'Never stays' }))).toBe('conflict');
    expect(writes).toBeGreaterThan(1);
  });

  it('writes a multi-line text with Windows line breaks once, not again and again', async () => {
    const { store, writes } = await projectWithTicket();
    const before = writes().length;

    await store.updateMap(PROJECT, { notes: 'First line\r\nSecond line' });

    expect(writes().length).toBe(before + 1);
  });
});

describe('GitHub issues backend: a create or merge that fails halfway', () => {
  const blockedTicket = () => newTicket({ title: 'Hosting', blockers: [2, 3] });

  /** The map (issue 1), two tickets (issues 2 and 3); the next new ticket is issue 4. */
  async function withBlockers() {
    const context = await projectWithTicket();
    await context.store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    return context;
  }

  it.each([
    ['writing the question codes', `PATCH repos/${PROJECT}/issues/4`, 0],
    ['the sub-issue link', `POST repos/${PROJECT}/issues/1/sub_issues`, 0],
    ['the first blocker link', `POST repos/${PROJECT}/issues/4/dependencies/blocked_by`, 0],
    ['the second blocker link', `POST repos/${PROJECT}/issues/4/dependencies/blocked_by`, 1],
  ])('a retry of a create that failed at %s finishes the same issue with every link', async (_case, step, after) => {
    const { github, store, issue, repository } = await withBlockers();
    github.failNext(step, after);

    expect(await refusal(store.createTicket(PROJECT, blockedTicket()))).toBe('backend');
    const created = await store.createTicket(PROJECT, blockedTicket());

    expect(created.id.number).toBe(4);
    expect(created.blockers).toEqual([2, 3]);
    expect(created.questions.map((question) => question.code)).toEqual(['Q4.1', 'Q4.2']);
    expect(repository.issues.size).toBe(4);
    expect(issue(1).subIssues).toEqual([issue(2).id, issue(3).id, issue(4).id]);
    expect(issue(4).blockedBy).toEqual([issue(2).id, issue(3).id]);
  });

  it('a second ticket with the same words as a finished one is a new ticket', async () => {
    const { store, repository } = await withBlockers();

    await store.createTicket(PROJECT, blockedTicket());
    const again = await store.createTicket(PROJECT, blockedTicket());

    expect(again.id.number).toBe(5);
    expect(repository.issues.size).toBe(5);
  });

  it('leaves alone an unlinked issue that only shares the title and kind', async () => {
    const { store, github, issue } = await withBlockers();
    github.addIssue(PROJECT, { title: 'Hosting', labels: ['wayfinder:grilling'], body: '### Question\nSomething else\n\n### Why it matters\n\n### Assumptions\n\n### Questions\n\n### Blocked by\n' });

    const created = await store.createTicket(PROJECT, blockedTicket());

    expect(created.id.number).toBe(5);
    expect(issue(4).body).toContain('Something else');
  });

  it('a damaged issue with the same title never stops a new ticket', async () => {
    const { store, github } = await withBlockers();
    github.addIssue(PROJECT, { title: 'Hosting', labels: ['wayfinder:grilling'], body: 'Hand-edited' });

    expect((await store.createTicket(PROJECT, blockedTicket())).id.number).toBe(5);
  });

  it.each([
    ['the decision comment', `POST repos/${PROJECT}/issues/2/comments`, null],
    ['the settled line', `PATCH repos/${PROJECT}/issues/1`, null],
    ['the close', `PATCH repos/${PROJECT}/issues/2`, null],
    // The list comes after the close, and the map's own reads match the same path: armed by the close.
    ['the map-done check', `GET repos/${PROJECT}/issues`, `PATCH repos/${PROJECT}/issues/2`],
  ])('a retry of a merge that failed at %s ends with one decision, one line and the duplicate link', async (_case, step, armedBy) => {
    const { github, store, issue, ticket } = await projectWithTicket();
    const into = await store.createTicket(PROJECT, newTicket({ title: 'Sign-in' }));
    if (armedBy === null) {
      github.failNext(step);
    } else {
      github.before(armedBy, () => github.failNext(step));
    }

    expect(await refusal(store.mergeTicket(ticket, into.id))).toBe('backend');
    await store.mergeTicket(ticket, into.id);

    expect(await store.getTicket(ticket)).toMatchObject({ state: 'closed', duplicateOf: 3 });
    expect(issue(2)).toMatchObject({ stateReason: 'duplicate', duplicateIssueId: issue(3).id });
    expect((await store.listDecisions(ticket)).map((decision) => decision.text)).toEqual(['Merged into #3']);
    expect((await store.getMap(PROJECT)).settled).toEqual([{ ticket: 2, gist: 'Merged into #3' }]);
  });
});

describe('GitHub issues backend: tags set by hand', () => {
  /** The rule the tagging skill teaches: a comment whose first line is exactly this marks a hand-tagged ticket. */
  const SKILL_MARKER_LINE = '<!-- grillo:tags-by-hand -->';
  const markerBodies = (repository: ReturnType<typeof setup>['repository'], number: number) =>
    repository.comments.filter((comment) => comment.issue === number && comment.body.split('\n')[0] === SKILL_MARKER_LINE).map(({ body }) => body);

  it('sets the domain labels and writes one tags-by-hand marker naming who, when and the domains', async () => {
    const { store, repository, issue, ticket, writes } = await projectWithTicket();
    issue(2).labels.push('bug');
    const before = writes().length;

    const tagged = await store.tagTicketByHand(ticket, { domains: ['platform', 'product'], noDomain: false });

    expect(tagged).toMatchObject({ domains: ['platform', 'product'], noDomain: false });
    expect(issue(2).labels).toEqual(['wayfinder:grilling', 'bug', 'domain:platform', 'domain:product']);
    expect(markerBodies(repository, 2)).toEqual([
      formatTagsByHand({ who: 'ada-example', when: START.toISOString(), domains: ['platform', 'product'], noDomain: false }),
    ]);
    expect(writes().slice(before).map((call) => /--method (\w+) \S+?(issues\/\d+(?:\/comments)?)\b/.exec(call)?.slice(1).join(' '))).toEqual([
      'PATCH issues/2',
      'POST issues/2/comments',
    ]);
  });

  it('writes the marker with "none" for the "no domain" tag, and the latest marker is the one that counts', async () => {
    const { store, repository, issue, ticket } = await projectWithTicket();
    await store.tagTicketByHand(ticket, { domains: ['platform'], noDomain: false });

    const tagged = await store.tagTicketByHand(ticket, { domains: [], noDomain: true });

    expect(tagged).toMatchObject({ domains: [], noDomain: true });
    expect(issue(2).labels).toEqual(['wayfinder:grilling', 'domain:none']);
    const markers = markerBodies(repository, 2);
    expect(markers).toHaveLength(2);
    expect(markers[1]).toContain('\ndomains: none\n');
    expect(parseTagsByHand(markers[1], 'the latest marker')).toMatchObject({ who: 'ada-example', domains: [], noDomain: true });
  });

  it('leaves the tags a member set by hand through a tagging round, which still tags every other ticket', async () => {
    const { store, repository, issue, ticket } = await projectWithTicket();
    const other = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    await store.tagTicketByHand(ticket, { domains: ['platform'], noDomain: false });

    // A tagging round as the skill runs it: a ticket with a marker comment is left alone, every other one is relabelled.
    for (const entry of repository.issues.values()) {
      if (entry.number === 1 || markerBodies(repository, entry.number).length > 0) continue;
      entry.labels = [...entry.labels.filter((label) => !label.startsWith('domain:')), 'domain:product'];
    }

    await expect(store.getTicket(ticket)).resolves.toMatchObject({ domains: ['platform'], noDomain: false });
    await expect(store.getTicket(other.id)).resolves.toMatchObject({ domains: ['product'] });
    expect(parseTagsByHand(markerBodies(repository, 2).at(-1)!, 'the latest marker').domains).toEqual(
      issue(2).labels.filter((label) => label.startsWith('domain:')).map((label) => label.slice('domain:'.length)),
    );
  });

  it('hands an untagged ticket back to the tagging round: its domain labels go and every marker is deleted', async () => {
    const { store, repository, issue, ticket, github } = await projectWithTicket();
    await store.tagTicketByHand(ticket, { domains: [], noDomain: true });
    github.addComment(PROJECT, 2, OTHER, formatTagsByHand({ who: OTHER, when: START.toISOString(), domains: [], noDomain: true }));
    await store.createAnswer(ticket, plainAnswer());

    const untagged = await store.tagTicketByHand(ticket, { domains: [], noDomain: false });

    expect(untagged).toMatchObject({ domains: [], noDomain: false });
    expect(issue(2).labels).toEqual(['wayfinder:grilling']);
    expect(markerBodies(repository, 2)).toEqual([]);
    await expect(store.listAnswers(ticket)).resolves.toHaveLength(1);
  });

  it.each([
    ['"no domain" together with a domain', { noDomain: true, domains: ['platform'] }],
    ['a domain no member declared', { noDomain: false, domains: ['finance'] }],
    ['the domain name "none", which is the no-domain tag', { noDomain: false, domains: ['none'] }],
    ['no domain list', { noDomain: false }],
    ['a "no domain" that is not true or false', { noDomain: 'yes', domains: [] }],
    ['no tags at all', null],
  ])('refuses tags with %s without writing anything', async (_case, tags) => {
    const { store, ticket, writes } = await projectWithTicket();
    const before = writes().length;

    expect(await refusal(store.tagTicketByHand(ticket, tags as never))).toBe('invalid');
    expect(writes()).toHaveLength(before);
  });

  it('refuses a hand change on a closed project as read-only before writing anything', async () => {
    const { store, repository, ticket, writes } = await projectWithTicket();
    repository.archived = true;
    const before = writes().length;

    expect(await refusal(store.tagTicketByHand(ticket, { domains: ['platform'], noDomain: false }))).toBe('read-only');
    expect(writes()).toHaveLength(before);
  });
});

describe('GitHub issues backend: the claim rule', () => {
  it('claims a ticket for the signed-in member, and claiming it again keeps it', async () => {
    const { store, issue, ticket } = await projectWithTicket();

    expect((await store.claimTicket(ticket)).assignee).toBe('ada-example');
    expect((await store.claimTicket(ticket)).assignee).toBe('ada-example');
    expect(issue(2).assignees).toEqual(['ada-example']);
  });

  it.each(['claimTicket', 'sendTicket'] as const)('refuses %s when another member holds the ticket', async (method) => {
    const { store, github, ticket } = await projectWithTicket();
    github.assignFromElsewhere(PROJECT, 2, 'cy-example');

    expect(await refusal(store[method](ticket, OTHER))).toBe('conflict');
  });

  it('loses a race to a member assigned first: unassigns itself and refuses with conflict', async () => {
    const { store, github, issue, ticket } = await projectWithTicket();
    github.before(`POST repos/${PROJECT}/issues/2/assignees`, () => github.assignFromElsewhere(PROJECT, 2, OTHER));

    expect(await refusal(store.claimTicket(ticket))).toBe('conflict');

    expect(issue(2).assignees).toEqual([OTHER]);
    expect(issue(2).events).toEqual([
      { event: 'assigned', assignee: OTHER },
      { event: 'assigned', assignee: 'ada-example' },
      { event: 'unassigned', assignee: 'ada-example' },
    ]);
  });

  it('wins a race against a member assigned later and keeps the ticket, leaving the later one to unassign itself', async () => {
    const { store, github, issue, ticket } = await projectWithTicket();
    github.before(`POST repos/${PROJECT}/issues/2/assignees`, () =>
      github.before(`GET repos/${PROJECT}/issues/2`, () => github.assignFromElsewhere(PROJECT, 2, OTHER)),
    );

    expect((await store.claimTicket(ticket)).assignee).toBe('ada-example');

    expect(issue(2).assignees).toEqual(['ada-example', OTHER]);
  });

  it('sends a ticket to a member, reassigns it while unanswered, and releases it to the pool with its open questions', async () => {
    const { store, issue, ticket } = await projectWithTicket();

    expect((await store.sendTicket(ticket, 'BEN-example')).assignee).toBe(OTHER);
    expect((await store.reassignTicket(ticket, 'ada-example')).assignee).toBe('ada-example');
    const released = await store.releaseTicket(ticket);

    expect(released.assignee).toBeNull();
    expect(issue(2).assignees).toEqual([]);
    expect(released.questions.map((question) => question.code)).toEqual(['Q2.1', 'Q2.2']);
  });

  it('refuses to reassign a ticket that has an answer', async () => {
    const { store, ticket } = await projectWithTicket();
    await store.sendTicket(ticket, OTHER);
    await store.createAnswer(ticket, plainAnswer());

    expect(await refusal(store.reassignTicket(ticket, 'ada-example'))).toBe('conflict');
  });

  it.each([
    ['send to someone who is not a member', (store: IssuesStore, ticket: TicketId) => store.sendTicket(ticket, 'stranger')],
    ['send to a value that is not a login', (store: IssuesStore, ticket: TicketId) => store.sendTicket(ticket, 'ben example')],
    ['claim a closed ticket', async (store: IssuesStore, ticket: TicketId) => {
      await store.closeTicket(ticket);
      return store.claimTicket(ticket);
    }],
    ['release a closed ticket', async (store: IssuesStore, ticket: TicketId) => {
      await store.closeTicket(ticket);
      return store.releaseTicket(ticket);
    }],
  ])('refuses to %s', async (_case, call) => {
    const { store, ticket } = await projectWithTicket();

    expect(await refusal(call(store, ticket))).toBe('invalid');
  });

  it('refuses to reassign a ticket to a member without repository access and leaves the holder assigned', async () => {
    const { store, repository, issue, ticket } = await projectWithTicket();
    repository.files.set('.grillo/members.json', JSON.stringify([...MEMBERS, { login: 'cy-example', role: '', domains: [] }]));
    await store.sendTicket(ticket, OTHER);

    expect(await refusal(store.reassignTicket(ticket, 'cy-example'))).toBe('invalid');

    expect(issue(2).assignees).toEqual([OTHER]);
    expect((await store.getTicket(ticket)).assignee).toBe(OTHER);
  });

  it('refuses to send a ticket to a member GitHub will not assign, because they have no access yet', async () => {
    const { store, repository, issue, ticket } = await projectWithTicket();
    repository.files.set('.grillo/members.json', JSON.stringify([...MEMBERS, { login: 'cy-example', role: '', domains: [] }]));

    expect(await refusal(store.sendTicket(ticket, 'cy-example'))).toBe('invalid');
    expect(issue(2).assignees).toEqual([]);
  });
});

describe('GitHub issues backend: questions', () => {
  it('adds, edits and removes questions without ever reusing a code', async () => {
    const { store, issue, ticket } = await projectWithTicket();

    await store.removeQuestion(ticket, 'Q2.2');
    await store.addQuestion(ticket, 'Who hosts it?');
    const updated = await store.updateQuestion(ticket, 'Q2.1', 'Which sign-in provider?');

    expect(updated.questions).toEqual([
      { code: 'Q2.1', text: 'Which sign-in provider?', answered: false },
      { code: 'Q2.3', text: 'Who hosts it?', answered: false },
    ]);
    expect(issue(2).body).toContain('### Questions\n- Q2.1 Which sign-in provider?\n- Q2.2 (removed)\n- Q2.3 Who hosts it?\n');
  });

  it('refuses to edit an unknown or removed question, remove an answered one, or name a question "(removed)"', async () => {
    const { store, ticket } = await projectWithTicket();
    await store.createAnswer(ticket, plainAnswer());
    await store.removeQuestion(ticket, 'Q2.2');

    expect(await refusal(store.updateQuestion(ticket, 'Q2.9', 'text'))).toBe('invalid');
    expect(await refusal(store.updateQuestion(ticket, 'Q2.2', 'text'))).toBe('invalid');
    expect(await refusal(store.removeQuestion(ticket, 'Q2.1'))).toBe('conflict');
    expect(await refusal(store.addQuestion(ticket, '(removed)'))).toBe('invalid');
  });

  it.each(['Q2:1', '[Q2.1]', '#Q2.1', 'Q2.1=', 'Q2.1\n', 'Q3.1', 'q2.1'])('refuses the question code %j', async (code) => {
    const { store, ticket } = await projectWithTicket();

    expect(await refusal(store.updateQuestion(ticket, code, 'text'))).toBe('invalid');
  });
});

describe('GitHub issues backend: answers, discussions and decisions', () => {
  it('records an answer as a marked comment with who, when and sources, marks its question answered, and edits and deletes it', async () => {
    const { store, repository, ticket } = await projectWithTicket();

    const answer = await store.createAnswer(ticket, { question: 'Q2.1', text: 'GitHub sign-in', sources: ['S1'], via: 'generic-agent', fromComment: null });

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
    expect(repository.comments[0].body).toBe(
      '<!-- grillo:answer -->\nwho: ada-example\nwhen: 2026-10-24T09:15:00.000Z\nsources: S1\nvia: generic-agent\nquestion: Q2.1\nfrom:\n\nGitHub sign-in',
    );
    expect((await store.getTicket(ticket)).questions[0].answered).toBe(true);
    await store.updateAnswer(ticket, answer.id, 'GitHub sign-in only');
    expect((await store.listAnswers(ticket)).map((entry) => entry.text)).toEqual(['GitHub sign-in only']);
    await store.deleteAnswer(ticket, answer.id);
    expect((await store.getTicket(ticket)).questions[0].answered).toBe(false);
  });

  it('turns a member comment from GitHub into an answer once, and undoing the answer puts it back unanswered', async () => {
    const { store, github, ticket } = await projectWithTicket();
    const written = github.addComment(PROJECT, 2, OTHER, 'Use GitHub, nothing else');
    const comment = { id: String(written.id), ticket, author: OTHER, when: written.createdAt, text: 'Use GitHub, nothing else' };
    expect(await store.listPickupComments(ticket)).toEqual([comment]);

    const answer = await store.createAnswer(ticket, { question: 'Q2.1', text: 'GitHub only', sources: [], via: 'github', fromComment: comment.id });

    expect(await store.listPickupComments(ticket)).toEqual([]);
    expect((await store.getTicket(ticket)).questions[0].answered).toBe(true);
    const again = { question: 'Q2.1', text: 'again', sources: [], via: 'github' as const, fromComment: comment.id };
    expect(await refusal(store.createAnswer(ticket, again))).toBe('invalid');
    await store.deleteAnswer(ticket, answer.id);
    expect(await store.listPickupComments(ticket)).toEqual([comment]);
    expect((await store.getTicket(ticket)).questions[0].answered).toBe(false);
  });

  it('refuses to turn a comment that is not a plain comment of this ticket into an answer', async () => {
    const { store, github, ticket } = await projectWithTicket();
    const other = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    const elsewhere = github.addComment(PROJECT, other.id.number, OTHER, 'Free for all');
    const answer = await store.createAnswer(ticket, plainAnswer());

    for (const fromComment of [String(elsewhere.id), answer.id, '999']) {
      expect(await refusal(store.createAnswer(ticket, { ...plainAnswer(), fromComment }))).toBe('invalid');
    }
  });

  it('lists a comment from a deleted GitHub account under the name ghost', async () => {
    const { store, github, ticket } = await projectWithTicket();
    github.addComment(PROJECT, 2, null, 'An old remark');

    expect((await store.listPickupComments(ticket)).map((entry) => entry.author)).toEqual(['ghost']);
  });

  it.each([
    ['an answer', (store: IssuesStore, ticket: TicketId) => store.createAnswer(ticket, plainAnswer('Q2.9'))],
    ['a discussion', (store: IssuesStore, ticket: TicketId) =>
      store.createDiscussion(ticket, { question: 'Q2.9', transcript: 'x', sessionFile: null, sources: [], via: null })],
    ['a discussion with a session file outside the sessions folder', (store: IssuesStore, ticket: TicketId) =>
      store.createDiscussion(ticket, { question: 'Q2.1', transcript: 'x', sessionFile: '../secret.md', sources: [], via: null })],
    ['an answer with a source that is not S<n>', (store: IssuesStore, ticket: TicketId) => store.createAnswer(ticket, { ...plainAnswer(), sources: ['S1', 'Q2.1'] })],
    ['an answer arriving by an unknown way', (store: IssuesStore, ticket: TicketId) => store.createAnswer(ticket, { ...plainAnswer(), via: 'email' as never })],
  ])('refuses %s', async (_case, call) => {
    const { store, ticket } = await projectWithTicket();

    expect(await refusal(call(store, ticket))).toBe('invalid');
  });

  it('keeps a discussion word for word with its session file, and edits and deletes it', async () => {
    const { store, ticket } = await projectWithTicket();

    const discussion = await store.createDiscussion(ticket, {
      question: 'Q2.1',
      transcript: 'We talked about GitHub.\n\nAt length.',
      sessionFile: '.grillo/sessions/2026-10-24-091500.md',
      sources: ['S2'],
      via: null,
    });
    await store.updateDiscussion(ticket, discussion.id, 'We talked about GitHub at length.');

    expect(discussion.transcript).toBe('We talked about GitHub.\n\nAt length.');
    expect(await store.listDiscussions(ticket)).toEqual([{ ...discussion, transcript: 'We talked about GitHub at length.' }]);
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
    ['updateAnswer', (store: IssuesStore, ticket: TicketId) => store.updateAnswer(ticket, '999', 'x')],
    ['updateAnswer with an id that is not a comment id', (store: IssuesStore, ticket: TicketId) => store.updateAnswer(ticket, 'c1', 'x')],
    ['deleteDiscussion', (store: IssuesStore, ticket: TicketId) => store.deleteDiscussion(ticket, '999')],
    ['deleteDecision', (store: IssuesStore, ticket: TicketId) => store.deleteDecision(ticket, '999')],
    ['deleteDecision with the id of an answer', async (store: IssuesStore, ticket: TicketId) =>
      store.deleteDecision(ticket, (await store.createAnswer(ticket, plainAnswer())).id)],
    ['getTicket', (store: IssuesStore) => store.getTicket({ project: PROJECT, number: 99 })],
  ])('refuses %s for a record that does not exist', async (_case, call) => {
    const { store, ticket } = await projectWithTicket();

    expect(await refusal(call(store, ticket))).toBe('not-found');
  });
});

describe('GitHub issues backend: lists that survive one damaged ticket', () => {
  const QUESTIONS_DAMAGED = '### Question\n\n### Why it matters\n\n### Assumptions\n\n### Questions\n- Q7.1 x\n\n### Blocked by\n';

  it.each([
    ['a second kind label', (context: Awaited<ReturnType<typeof projectWithTicket>>) => context.issue(3).labels.push('wayfinder:task')],
    ['a hand-edited section', (context: Awaited<ReturnType<typeof projectWithTicket>>) => (context.issue(3).body = QUESTIONS_DAMAGED)],
    ['a damaged marked comment', (context: Awaited<ReturnType<typeof projectWithTicket>>) =>
      context.github.addComment(PROJECT, 3, OTHER, '<!-- grillo:answer -->\nwho: ben-example\n\nGitHub')],
  ])('lists every other ticket and flags one with %s, with the reason', async (_case, damage) => {
    const context = await projectWithTicket();
    const { store, issue } = context;
    await store.createTicket(PROJECT, newTicket({ title: 'Pricing', kind: 'research' }));
    await store.createTicket(PROJECT, newTicket({ title: 'Hosting' }));
    issue(3).assignees.push(OTHER);
    damage(context);

    const tickets = await store.listTickets(PROJECT);

    expect(tickets.map((ticket) => [ticket.id.number, ticket.title, ticket.damaged ?? null])).toEqual([
      [2, 'Login flow', null],
      [3, 'Pricing', expect.stringMatching(/Issue #3|comment/)],
      [4, 'Hosting', null],
    ]);
    expect(tickets[1]).toMatchObject({ kind: 'research', assignee: OTHER, state: 'open', questions: [] });
  });

  it('reports a close and a merge as done when another ticket or the map turns out damaged afterwards', async () => {
    const { store, issue, ticket } = await projectWithTicket();
    const into = await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));
    const third = await store.createTicket(PROJECT, newTicket({ title: 'Hosting' }));
    await store.createTicket(PROJECT, newTicket({ title: 'Roles' }));
    issue(5).labels.push('wayfinder:task');

    expect(await store.closeTicket(third.id)).toEqual({ mapDone: false });
    expect(await store.mergeTicket(ticket, into.id)).toEqual({ mapDone: false });
    expect([issue(2).state, issue(4).state]).toEqual(['closed', 'closed']);

    issue(5).state = 'closed';
    await store.reopenTicket(third.id);
    await store.closeTicket(into.id);
    issue(1).body = 'Hand-edited map';
    expect(await store.closeTicket(third.id)).toEqual({ mapDone: false });
    expect(issue(4).state).toBe('closed');
  });

  it('lists the waiting comments of every open ticket with one comment listing, however many tickets there are', async () => {
    const { store, github, ticket } = await projectWithTicket();
    const others = [];
    for (const title of ['Pricing', 'Hosting', 'Roles']) {
      others.push(await store.createTicket(PROJECT, newTicket({ title })));
    }
    const first = github.addComment(PROJECT, 2, OTHER, 'Use GitHub');
    const turned = github.addComment(PROJECT, 3, OTHER, 'Free for all');
    await store.createAnswer(others[0].id, { ...plainAnswer('Q3.1'), via: 'github', fromComment: String(turned.id) });
    const later = github.addComment(PROJECT, 4, null, 'Self-hosted');
    github.addComment(PROJECT, 4, OTHER, '<!-- grillo:answer -->\nwho: ben-example\n\nDamaged');
    await store.closeTicket(others[2].id);
    github.addComment(PROJECT, 5, OTHER, 'On a closed ticket');
    github.calls.length = 0;

    const comments = await store.listProjectPickupComments(PROJECT);

    expect(comments).toEqual([
      { id: String(first.id), ticket, author: OTHER, when: first.createdAt, text: 'Use GitHub' },
      { id: String(later.id), ticket: others[1].id, author: 'ghost', when: later.createdAt, text: 'Self-hosted' },
    ]);
    expect(github.calls.filter((call) => call.includes('/comments'))).toEqual([`gh api repos/${PROJECT}/issues/comments?per_page=100&page=1`]);
    expect(github.calls.filter((call) => /issues\/\d+/.test(call))).toEqual([]);
  });
});

describe('GitHub issues backend: what GitHub hands back is checked', () => {
  const ISSUE = `GET repos/${PROJECT}/issues/2`;
  const body = '### Question\n\n### Why it matters\n\n### Assumptions\n\n### Questions\n- Q2.1 Which provider?\n\n### Blocked by\n';
  const good = { id: 9002, number: 2, title: 'Login flow', body, state: 'open', labels: [{ name: 'wayfinder:task' }], assignees: [], comments: 1 };

  it.each([
    ['null', 'null'],
    ['a list', '[]'],
    ['not JSON', 'Not Found'],
    ['a null id', JSON.stringify({ ...good, id: null })],
    ['a number given as text', JSON.stringify({ ...good, number: '2' })],
    ['an unknown state', JSON.stringify({ ...good, state: 'merged' })],
    ['a null label', JSON.stringify({ ...good, labels: [null] })],
    ['a null assignee', JSON.stringify({ ...good, assignees: [null] })],
    ['an assignee that is not a login', JSON.stringify({ ...good, assignees: [{ login: 'ada example' }] })],
    ['a body that is not text', JSON.stringify({ ...good, body: 7 })],
    ['a hand-edited body', JSON.stringify({ ...good, body: '' })],
    ['a missing comment count', JSON.stringify({ ...good, comments: undefined })],
    ['a null comment count', JSON.stringify({ ...good, comments: null })],
    ['a comment count given as text', JSON.stringify({ ...good, comments: '1' })],
  ])('refuses an issue answer that is %s as a backend error', async (_case, stdout) => {
    const { store, github, ticket } = await projectWithTicket();
    await store.createAnswer(ticket, plainAnswer());
    github.answerNext(ISSUE, stdout);

    expect(await refusal(store.getTicket(ticket))).toBe('backend');
  });

  it('reads the good issue answer of these checks, so each refusal above has one cause', async () => {
    const { store, github, ticket } = await projectWithTicket();
    await store.createAnswer(ticket, plainAnswer());
    github.answerNext(ISSUE, JSON.stringify(good));

    expect((await store.getTicket(ticket)).questions).toEqual([{ code: 'Q2.1', text: 'Which provider?', answered: true }]);
  });

  it.each([
    ['a null comment', '[null]'],
    ['a comment id given as text', JSON.stringify([{ id: '7', body: 'x', user: { login: OTHER }, created_at: START.toISOString() }])],
    ['a comment without a date', JSON.stringify([{ id: 7, body: 'x', user: { login: OTHER } }])],
  ])('refuses a comment list holding %s as a backend error', async (_case, stdout) => {
    const { store, github, ticket } = await projectWithTicket();
    github.addComment(PROJECT, 2, OTHER, 'Use GitHub');
    github.answerNext(`GET repos/${PROJECT}/issues/2/comments`, stdout);

    expect(await refusal(store.listPickupComments(ticket))).toBe('backend');
  });

  it('refuses a damaged timeline during a claim race as a backend error', async () => {
    const { store, github, ticket } = await projectWithTicket();
    github.before(`POST repos/${PROJECT}/issues/2/assignees`, () => github.assignFromElsewhere(PROJECT, 2, OTHER));
    github.answerNext(`GET repos/${PROJECT}/issues/2/timeline`, JSON.stringify([{ event: 'assigned', assignee: null }]));

    expect(await refusal(store.claimTicket(ticket))).toBe('backend');
  });

  it.each([
    ['two kind labels', { labels: ['wayfinder:grilling', 'wayfinder:task'] }],
    ['domain:none together with a domain', { labels: ['wayfinder:grilling', 'domain:none', 'domain:platform'] }],
    ['a hand-edited body', { body: 'Just some notes' }],
    ['a question line of another ticket', { body: '### Question\n\n### Why it matters\n\n### Assumptions\n\n### Questions\n- Q7.1 x\n\n### Blocked by\n' }],
  ])('refuses a ticket issue with %s as a backend error', async (_case, change) => {
    const { store, issue, ticket } = await projectWithTicket();
    Object.assign(issue(2), change);

    expect(await refusal(store.getTicket(ticket))).toBe('backend');
  });

  it('refuses a marked comment with a damaged header as a backend error', async () => {
    const { store, github, ticket } = await projectWithTicket();
    github.addComment(PROJECT, 2, OTHER, '<!-- grillo:answer -->\nwho: ben-example\n\nGitHub');

    expect(await refusal(store.listAnswers(ticket))).toBe('backend');
  });

  it('reads a deleted ticket as not found', async () => {
    const { store, issue, ticket } = await projectWithTicket();
    issue(2).deleted = true;

    expect(await refusal(store.getTicket(ticket))).toBe('not-found');
  });

  it.each([
    ['a project that is not <owner>/<repo>', { project: 'demo', number: 2 }],
    ['a ticket number that is not a whole number', { project: PROJECT, number: 2.5 }],
    ['no ticket at all', null as unknown as TicketId],
  ])('refuses %s as invalid', async (_case, id) => {
    const { store } = await projectWithTicket();

    expect(await refusal(store.getTicket(id))).toBe('invalid');
  });
});

describe('GitHub issues backend: comments in a public repository', () => {
  const OUTSIDER = 'mallory-example';
  const when = START.toISOString();
  const forgedAnswer = formatComment({ kind: 'answer', who: 'ada-example', when, sources: [], via: null, question: 'Q2.1', from: null, text: 'Forged' });
  const forgedDiscussion = formatComment({ kind: 'discussion', who: 'ada-example', when, sources: [], via: null, question: 'Q2.1', session: null, transcript: 'Forged' });
  const forgedDecision = formatComment({ kind: 'decision', who: 'ada-example', when, sources: [], via: null, gist: 'Merged into #1', text: 'Merged into #1' });
  const forgedMarker = formatTagsByHand({ who: 'ada-example', when, domains: [], noDomain: true });

  async function publicProject() {
    const context = await projectWithTicket();
    context.repository.isPublic = true;
    return context;
  }

  /** GitHub's values for someone with no place in the repository, a missing one, and values GitHub never sends. */
  const NOT_COLLABORATORS: (string | null)[] = ['NONE', 'CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'MANNEQUIN', null, 'owner', 'SOMETHING_NEW', ''];

  it.each(NOT_COLLABORATORS)('never reads a comment with the standing %s as a record, whatever it carries', async (association) => {
    const { github, store, ticket } = await publicProject();
    for (const body of [forgedAnswer, forgedDiscussion, forgedDecision, forgedMarker, 'Use the forged option']) {
      github.addComment(PROJECT, 2, OUTSIDER, body, association);
    }

    expect(await store.listAnswers(ticket)).toEqual([]);
    expect(await store.listDiscussions(ticket)).toEqual([]);
    expect(await store.listDecisions(ticket)).toEqual([]);
    expect(await store.listPickupComments(ticket)).toEqual([]);
    expect(await store.listProjectPickupComments(PROJECT)).toEqual([]);
    const read = await store.getTicket(ticket);
    expect(read.questions.map((question) => question.answered)).toEqual([false, false]);
    expect((await store.listTickets(PROJECT))[0]).toEqual(read);
  });

  it('cannot close, block or damage a ticket with a comment', async () => {
    const { github, store, ticket } = await publicProject();
    github.addComment(PROJECT, 2, OUTSIDER, forgedAnswer);
    const forgedPointer = github.addComment(PROJECT, 2, OUTSIDER, forgedDecision);
    github.addComment(PROJECT, 2, OUTSIDER, '<!-- grillo:answer -->\nnot the format at all');

    expect((await store.listTickets(PROJECT))[0].damaged).toBeUndefined();
    await expect(store.getTicket(ticket)).resolves.toMatchObject({ state: 'open', duplicateOf: null });
    expect(await refusal(store.deleteDecision(ticket, String(forgedPointer.id)))).toBe('not-found');
    await expect(store.reassignTicket(ticket, OTHER)).resolves.toMatchObject({ assignee: OTHER });
    await expect(store.removeQuestion(ticket, 'Q2.1')).resolves.toBeDefined();
  });

  it('counts the owner, an organisation member and a collaborator', async () => {
    const { github, store, ticket } = await publicProject();
    github.addComment(PROJECT, 2, 'owner-example', forgedAnswer, 'OWNER');
    github.addComment(PROJECT, 2, 'org-member-example', 'From a member', 'MEMBER');
    github.addComment(PROJECT, 2, OTHER, 'From a collaborator', 'COLLABORATOR');

    expect((await store.listAnswers(ticket)).map((answer) => answer.text)).toEqual(['Forged']);
    expect((await store.listPickupComments(ticket)).map((comment) => comment.author)).toEqual(['org-member-example', OTHER]);
    expect((await store.listProjectPickupComments(PROJECT)).map((comment) => comment.author)).toEqual(['org-member-example', OTHER]);
  });

  it("records and reads back the signed-in member's own answers as usual", async () => {
    const { store, ticket } = await publicProject();

    const answer = await store.createAnswer(ticket, plainAnswer());

    expect(await store.listAnswers(ticket)).toEqual([answer]);
    expect((await store.getTicket(ticket)).questions[0].answered).toBe(true);
  });

  it('stops counting a member once they left the repository: the question reads unanswered again', async () => {
    const { github, store, ticket } = await publicProject();
    const comment = github.addComment(PROJECT, 2, OTHER, forgedAnswer, 'COLLABORATOR');
    expect((await store.getTicket(ticket)).questions[0].answered).toBe(true);

    comment.association = 'CONTRIBUTOR';

    expect((await store.getTicket(ticket)).questions[0].answered).toBe(false);
  });

  it('hands tags back without touching a tags-by-hand marker from an outsider', async () => {
    const { github, repository, store, ticket } = await publicProject();
    const forged = github.addComment(PROJECT, 2, OUTSIDER, forgedMarker);
    github.addComment(PROJECT, 2, OTHER, forgedMarker);

    await store.tagTicketByHand(ticket, { domains: [], noDomain: false });

    expect(repository.comments.map((comment) => comment.id)).toEqual([forged.id]);
  });

  it("never takes an outsider's issue for a ticket: GitHub drops the labels of someone with no push access", async () => {
    const { github, store } = await publicProject();
    const issue = github.addIssue(PROJECT, { title: 'Forged ticket', body: '### Question\nForged' });

    expect(await refusal(store.getTicket({ project: PROJECT, number: issue.number }))).toBe('not-found');
    expect((await store.listTickets(PROJECT)).map((ticket) => ticket.id.number)).toEqual([2]);
  });

  it('leaves a private repository exactly as it was: every comment counts, whoever wrote it', async () => {
    const { github, store, ticket } = await projectWithTicket();
    github.addComment(PROJECT, 2, OUTSIDER, forgedAnswer, 'NONE');
    github.addComment(PROJECT, 2, OUTSIDER, 'A plain remark', 'NONE');

    expect((await store.listAnswers(ticket)).map((answer) => answer.text)).toEqual(['Forged']);
    expect((await store.listPickupComments(ticket)).map((comment) => comment.author)).toEqual([OUTSIDER]);
    expect((await store.listProjectPickupComments(PROJECT)).map((comment) => comment.author)).toEqual([OUTSIDER]);
  });
});
