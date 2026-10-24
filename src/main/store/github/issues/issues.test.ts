import { describe, expect, it } from 'vitest';
import { createMemorySettings } from '../../memory/settings';
import { StoreError, type NewTicket, type Store, type StoreErrorKind } from '../../store';
import type { TicketId } from '../../types';
import { createIssuesStore } from '.';
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
    ['an empty fog item', { fog: [''] }],
    ['a fog list that is not a list', { fog: 'Pricing' as unknown as string[] }],
  ])('refuses %s', async (_case, patch) => {
    const { store } = await projectWithTicket();

    expect(await refusal(store.updateMap(PROJECT, patch))).toBe('invalid');
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
    ['an unknown kind', { kind: 'meeting' as never }],
  ])('refuses to update a ticket with %s', async (_case, patch) => {
    const { store, ticket } = await projectWithTicket();
    await store.createTicket(PROJECT, newTicket({ title: 'Pricing' }));

    expect(await refusal(store.updateTicket(ticket, patch))).toBe('invalid');
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
