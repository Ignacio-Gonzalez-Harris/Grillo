import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProjectFixture, FixtureError, readFixtureFolder } from './fixture-check';

/** A made-up project snapshot that follows docs/store-layout.md: one map, one settled ticket, one open ticket. */
function validFixture(): Record<string, string> {
  return {
    'issues.json': JSON.stringify({
      map: { number: 1, title: 'Map', labels: ['wayfinder:map'], state: 'open', body: 'issues/1.md' },
      tickets: [
        {
          number: 2,
          title: 'Who borrows tools',
          labels: ['wayfinder:grilling', 'domain:product'],
          state: 'closed',
          assignee: 'ada-example',
          parent: 1,
          blockedBy: [],
          body: 'issues/2.md',
          comments: [
            { id: '2001', author: 'ada-example', createdAt: '2026-10-24T09:20:00.000Z', body: 'comments/2001.md' },
            { id: '2002', author: 'ada-example', createdAt: '2026-10-24T09:21:00.000Z', body: 'comments/2002.md' },
          ],
        },
        {
          number: 3,
          title: 'Which roles exist',
          labels: ['wayfinder:grilling'],
          state: 'open',
          assignee: null,
          parent: 1,
          blockedBy: [2],
          body: 'issues/3.md',
          comments: [],
        },
      ],
    }),
    'issues/1.md': [
      '### Destination',
      'A PRD for a made-up tool library.',
      '',
      '### Notes',
      '',
      '### Settled',
      '- #2 Members borrow with their key card',
      '',
      '### Fog',
      '- Permissions: who may lend tools',
      '',
      '### Out of scope',
      '',
    ].join('\n'),
    'issues/2.md': [
      '### Question',
      'Who borrows tools?',
      '',
      '### Why it matters',
      'Problem: every loan needs a borrower.',
      '',
      '### Assumptions',
      '',
      '### Questions',
      '- Q2.1 Who may borrow a tool?',
      '',
      '### Blocked by',
      '',
    ].join('\n'),
    'issues/3.md': [
      '### Question',
      'Which roles exist?',
      '',
      '### Why it matters',
      'Users and roles: the screens differ per role.',
      '',
      '### Assumptions',
      '',
      '### Questions',
      '- Q3.1 Which roles do members have?',
      '',
      '### Blocked by',
      '- #2',
      '',
    ].join('\n'),
    'comments/2001.md': [
      '<!-- grillo:answer -->',
      'who: ada-example',
      'when: 2026-10-24T09:20:00.000Z',
      'sources: S1',
      'via:',
      'question: Q2.1',
      'from:',
      '',
      'Every member with a key card.',
    ].join('\n'),
    'comments/2002.md': [
      '<!-- grillo:decision -->',
      'who: ada-example',
      'when: 2026-10-24T09:21:00.000Z',
      'sources: S1',
      'via:',
      'gist: Members borrow with their key card',
      '',
      'Members borrow with their key card.',
    ].join('\n'),
    '.grillo/sources/S1.md': ['kind: pasted-text', 'who: Ada Example, product', 'when: 2026-10-23T10:00:00.000Z', 'where: typed into Grillo', '', 'A tool library.'].join('\n'),
    '.grillo/members.json': JSON.stringify([{ login: 'ada-example', role: 'product', domains: ['product'] }]),
    '.grillo/structure.json': JSON.stringify({
      sections: [
        { name: 'Problem', note: 'What goes wrong' },
        { name: 'Users and roles', note: 'Who uses it' },
        { name: 'Permissions', note: 'Who may do what' },
      ],
    }),
  };
}

type Manifest = { map: Record<string, unknown> | null; tickets: (Record<string, unknown> | null)[] | null };

/** The valid fixture with its manifest changed. */
function withManifest(change: (manifest: Manifest) => void): Record<string, string> {
  const files = validFixture();
  const manifest = JSON.parse(files['issues.json']) as Manifest;
  change(manifest);
  return { ...files, 'issues.json': JSON.stringify(manifest) };
}

const ticket = (manifest: Manifest, index: number): Record<string, unknown> => (manifest.tickets as Record<string, unknown>[])[index];

/** The valid fixture with one file replaced (or removed with `null`). */
function withFile(path: string, content: string | null): Record<string, string> {
  const files = validFixture();
  if (content === null) {
    delete files[path];
  } else {
    files[path] = content;
  }
  return files;
}

/** The valid fixture with one text replaced inside one file. */
function replacing(path: string, from: string, to: string): Record<string, string> {
  const files = validFixture();
  if (!files[path].includes(from)) {
    throw new Error(`test setup: '${from}' is not in ${path}`);
  }
  files[path] = files[path].replace(from, to);
  return files;
}

describe('checkProjectFixture', () => {
  it('reads a snapshot that follows the store layout and reports whether the map is done', () => {
    const fixture = checkProjectFixture(validFixture());

    expect(fixture.map.settled).toEqual([{ ticket: 2, gist: 'Members borrow with their key card' }]);
    expect(fixture.tickets.map(({ number, kind, state }) => ({ number, kind, state }))).toEqual([
      { number: 2, kind: 'grilling', state: 'closed' },
      { number: 3, kind: 'grilling', state: 'open' },
    ]);
    expect(fixture.sources.map((source) => source.code)).toEqual(['S1']);
    expect(fixture.mapDone).toBe(false);
  });

  it('reads Windows line endings as the same snapshot', () => {
    const files = Object.fromEntries(Object.entries(validFixture()).map(([path, text]) => [path, text.replace(/\n/g, '\r\n')]));

    expect(checkProjectFixture(files).tickets).toHaveLength(2);
  });

  it.each<[string, Record<string, string>, string]>([
    ['no manifest', withFile('issues.json', null), 'issues.json'],
    ['a manifest that is not JSON', withFile('issues.json', '{ "map": '), 'issues.json'],
    ['a null manifest', withFile('issues.json', 'null'), 'issues.json'],
    ['a null map', withManifest((m) => (m.map = null)), 'map'],
    ['a null ticket list', withManifest((m) => (m.tickets = null)), 'tickets'],
    ['a null ticket', withManifest((m) => m.tickets?.push(null)), 'ticket'],
    ['a ticket number that is text', withManifest((m) => (ticket(m, 1).number = '3')), 'number'],
    ['a null label', withManifest((m) => (ticket(m, 1).labels = ['wayfinder:grilling', null])), 'labels'],
    ['a null comment', withManifest((m) => (ticket(m, 1).comments = [null])), 'comment'],
    ['a state that is neither open nor closed', withManifest((m) => (ticket(m, 1).state = 'done')), 'state'],
    ['two tickets with one number', withManifest((m) => (ticket(m, 1).number = 2)), 'twice'],
    ['a ticket numbered like the map', withManifest((m) => (ticket(m, 1).number = 1)), 'twice'],
    ['two comments with one id', withManifest((m) => (ticket(m, 0).comments = [...(ticket(m, 0).comments as unknown[]), ...(ticket(m, 0).comments as unknown[]).slice(0, 1)])), 'twice'],
    ['a body outside the fixture', withManifest((m) => (ticket(m, 1).body = '../outside.md')), 'path'],
    ['a body file that is missing', withManifest((m) => (ticket(m, 1).body = 'issues/9.md')), 'issues/9.md'],
  ])('refuses %s as a FixtureError', (_what, files, mentions) => {
    expect(() => checkProjectFixture(files)).toThrow(FixtureError);
    expect(() => checkProjectFixture(files)).toThrow(mentions);
  });

  it.each<[string, Record<string, string>, string]>([
    ['a map not titled Map', withManifest((m) => ((m.map as Record<string, unknown>).title = 'Plan')), 'Map'],
    ['a map carrying a kind label', withManifest((m) => ((m.map as Record<string, unknown>).labels = ['wayfinder:map', 'wayfinder:task'])), 'wayfinder:map'],
    ['a destination that is not a PRD', replacing('issues/1.md', 'A PRD for a made-up tool library.', 'Tickets for a tool library.'), 'A PRD'],
    ['a map body with a section missing', replacing('issues/1.md', '### Fog\n- Permissions: who may lend tools\n', ''), 'Fog'],
    ['a ticket with two kinds', withManifest((m) => (ticket(m, 1).labels = ['wayfinder:grilling', 'wayfinder:task'])), 'kind'],
    ['a ticket with no kind', withManifest((m) => (ticket(m, 1).labels = [])), 'kind'],
    ['no domain together with a domain', withManifest((m) => (ticket(m, 1).labels = ['wayfinder:grilling', 'domain:none', 'domain:product'])), 'domain:none'],
    ['a domain no member declared', withManifest((m) => (ticket(m, 1).labels = ['wayfinder:grilling', 'domain:legal'])), 'domain:legal'],
    ['a label Grillo does not write', withManifest((m) => (ticket(m, 1).labels = ['wayfinder:grilling', 'bug'])), 'bug'],
    ['one label twice', withManifest((m) => (ticket(m, 1).labels = ['wayfinder:grilling', 'wayfinder:grilling'])), 'twice'],
    ['an assignee who is no member', withManifest((m) => (ticket(m, 1).assignee = 'zed-example')), 'zed-example'],
    ['a ticket that is no sub-issue of the map', withManifest((m) => (ticket(m, 1).parent = 2)), 'sub-issue'],
    ['native blockers that disagree with the body', withManifest((m) => (ticket(m, 1).blockedBy = [])), 'Blocked by'],
    ['a blocker that is no ticket', blockedByUnknownTicket(), '#7'],
    ['a question code of another ticket', replacing('issues/3.md', '- Q3.1 ', '- Q2.1 '), 'another ticket'],
    ['question codes with a gap', replacing('issues/3.md', '- Q3.1 Which roles do members have?', '- Q3.1 Which roles?\n- Q3.3 Which teams?'), 'Q3.3'],
    ['a why-it-matters that names no structure section', replacing('issues/3.md', 'Users and roles: the', 'Roles: the'), 'structure section'],
    ['a fog line that names no structure section', replacing('issues/1.md', '- Permissions: who', '- permissions: who'), 'structure section'],
    ['a structure section nothing covers', replacing('issues/1.md', '- Permissions: who may lend tools\n', ''), 'Permissions'],
  ])('refuses %s', (_what, files, mentions) => {
    expect(() => checkProjectFixture(files)).toThrow(FixtureError);
    expect(() => checkProjectFixture(files)).toThrow(mentions);
  });

  it.each<[string, Record<string, string>, string]>([
    ['a comment with an unknown marker', replacing('comments/2001.md', '<!-- grillo:answer -->', '<!-- grillo:vote -->'), 'marker'],
    ['header lines out of order', replacing('comments/2001.md', 'sources: S1\nvia:', 'via:\nsources: S1'), 'comment 2001'],
    ['a recorder who is not the comment author', replacing('comments/2001.md', 'who: ada-example', 'who: ben-example'), 'author'],
    ['a moment that is not ISO 8601 in UTC', replacing('comments/2001.md', 'when: 2026-10-24T09:20:00.000Z', 'when: yesterday'), 'yesterday'],
    ['a moment with a local offset', replacing('comments/2001.md', 'when: 2026-10-24T09:20:00.000Z', 'when: 2026-10-24T11:20:00.000+02:00'), 'UTC'],
    ['an answer resting on no source', replacing('comments/2001.md', 'sources: S1', 'sources:'), 'source'],
    ['an answer citing a source that does not exist', replacing('comments/2001.md', 'sources: S1', 'sources: S1, S9'), 'S9'],
    ['sources split by a semicolon', replacing('comments/2001.md', 'sources: S1', 'sources: S1; S1'), 'sources'],
    ['a source code in brackets', replacing('comments/2001.md', 'sources: S1', 'sources: [S1]'), 'sources'],
    ['an answer recorded before its source was written', replacing('.grillo/sources/S1.md', 'when: 2026-10-23T10:00:00.000Z', 'when: 2026-10-25T10:00:00.000Z'), 'before'],
    ['an answer to a question of another ticket', replacing('comments/2001.md', 'question: Q2.1', 'question: Q3.1'), 'Q3.1'],
    ['an answer to a question the ticket does not hold', replacing('comments/2001.md', 'question: Q2.1', 'question: Q2.5'), 'Q2.5'],
    ['an answer to a removed question', replacing('issues/2.md', '- Q2.1 Who may borrow a tool?', '- Q2.1 (removed)'), 'removed'],
    ['an answer via GitHub with no comment it came from', replacing('comments/2001.md', 'via:', 'via: github'), 'from'],
    ['an answer from a comment that is not on the ticket', viaGitHubFrom('999'), '999'],
    ['an answer from a comment that is not plain', viaGitHubFrom('2002'), '2002'],
    ['a source file numbered 0', withFile('.grillo/sources/S0.md', validFixture()['.grillo/sources/S1.md']), 'S0.md'],
    ['source numbers with a gap', withFile('.grillo/sources/S3.md', validFixture()['.grillo/sources/S1.md']), 'S2'],
    ['a source with an unknown kind', replacing('.grillo/sources/S1.md', 'kind: pasted-text', 'kind: rumour'), 'S1.md'],
  ])('refuses %s', (_what, files, mentions) => {
    expect(() => checkProjectFixture(files)).toThrow(FixtureError);
    expect(() => checkProjectFixture(files)).toThrow(mentions);
  });

  it.each<[string, Record<string, string>, string]>([
    ['a settled line for an open ticket', replacing('issues/1.md', '- #2 Members', '- #3 Members'), '#3'],
    ['a settled line for no ticket', replacing('issues/1.md', '- #2 Members', '- #8 Members'), '#8'],
    ['a settled gist that differs from the decision', replacing('issues/1.md', '- #2 Members borrow with their key card', '- #2 Anyone borrows'), 'gist'],
    ['a decided ticket with no settled line', replacing('issues/1.md', '- #2 Members borrow with their key card\n', ''), 'Settled'],
    ['a closed ticket with a question left open', replacing('issues/2.md', '- Q2.1 Who may borrow a tool?', '- Q2.1 Who may borrow a tool?\n- Q2.2 For how long?'), 'Q2.2'],
    ['a closed ticket with neither a decision nor an out-of-scope line', withManifest((m) => (ticket(m, 0).comments = (ticket(m, 0).comments as unknown[]).slice(0, 1))), 'decision'],
    ['a discussion with no answer before it', discussionWithoutAnswer(), 'no answer'],
    ['a discussion cut from a session file that does not exist', discussionFromMissingSession(), 'session'],
  ])('refuses %s', (_what, files, mentions) => {
    expect(() => checkProjectFixture(files)).toThrow(FixtureError);
    expect(() => checkProjectFixture(files)).toThrow(mentions);
  });

  it.each([
    ['a bare number', '- Mobile app #3'],
    ['round brackets', '- Mobile app (#3)'],
    ['square brackets', '- Mobile app [#3]'],
    ['a colon after it', '- #3: a mobile app'],
    ['an equals sign before it', '- ticket=#3 a mobile app'],
  ])('finds a closed ticket named in an out-of-scope line with %s', (_what, line) => {
    expect(checkProjectFixture(ticketThreeClosedOutOfScope(line)).tickets[1].state).toBe('closed');
  });

  it.each([
    ['a longer number', '- Mobile app #30', 'no out-of-scope line naming #3'],
    ['letters after it', '- Mobile app #3a', 'no out-of-scope line naming #3'],
    ['a second hash', '- Mobile app ##3', 'no out-of-scope line naming #3'],
    ['a line break between hash and number', '- Mobile app #\n3', "must start with '- '"],
  ])('does not take %s for a closed ticket in an out-of-scope line', (_what, line, mentions) => {
    const files = ticketThreeClosedOutOfScope(line);

    expect(() => checkProjectFixture(files)).toThrow(FixtureError);
    expect(() => checkProjectFixture(files)).toThrow(mentions);
  });

  it('reads the tags a member set by hand from the latest tags-by-hand marker on a ticket', () => {
    const files = handTagged(['wayfinder:grilling', 'domain:product'], tagsByHandOf('ada-example', '2026-10-25T10:00:00.000Z', 'none'));
    files['comments/3002.md'] = tagsByHandOf('ada-example', '2026-10-25T11:00:00.000Z', 'product');
    files['issues.json'] = files['issues.json'].replace(
      '"body":"comments/3001.md"}]',
      '"body":"comments/3001.md"},{"id":"3002","author":"ada-example","createdAt":"2026-10-25T11:00:00.000Z","body":"comments/3002.md"}]',
    );
    const fixture = checkProjectFixture(files);

    expect(fixture.tickets[1].tagsByHand).toEqual({ who: 'ada-example', when: '2026-10-25T11:00:00.000Z', domains: ['product'], noDomain: false });
    expect(fixture.tickets[0].tagsByHand).toBeNull();
  });

  it.each<[string, Record<string, string>, string]>([
    ['a tags-by-hand marker its author did not write', handTagged(['wayfinder:grilling', 'domain:product'], tagsByHandOf('ben-example', '2026-10-25T10:00:00.000Z', 'product')), 'author'],
    ['a tags-by-hand marker at a moment that is not ISO 8601 in UTC', handTagged(['wayfinder:grilling', 'domain:product'], tagsByHandOf('ada-example', 'today', 'product')), 'today'],
    ['a tags-by-hand marker naming no domain', handTagged(['wayfinder:grilling'], tagsByHandOf('ada-example', '2026-10-25T10:00:00.000Z', '')), 'comment 3001'],
    ['a hand-tagged ticket whose labels differ from its marker', handTagged(['wayfinder:grilling', 'domain:none'], tagsByHandOf('ada-example', '2026-10-25T10:00:00.000Z', 'product')), 'by hand'],
    ['a ticket tagged no domain by hand that lost its tag', handTagged(['wayfinder:grilling'], tagsByHandOf('ada-example', '2026-10-25T10:00:00.000Z', 'none')), 'by hand'],
  ])('refuses %s', (_what, files, mentions) => {
    expect(() => checkProjectFixture(files)).toThrow(FixtureError);
    expect(() => checkProjectFixture(files)).toThrow(mentions);
  });

  it('reports the map done when no ticket is open and no fog is left', () => {
    const files = withManifest((m) => {
      m.tickets = [ticket(m, 0)];
    });
    files['issues/1.md'] = files['issues/1.md'].replace('### Fog\n- Permissions: who may lend tools\n', '### Fog\n');
    files['.grillo/structure.json'] = JSON.stringify({ sections: [{ name: 'Problem', note: 'What goes wrong' }] });

    expect(checkProjectFixture(files).mapDone).toBe(true);
  });
});

/** The valid fixture with ticket #3 closed as out of scope, `line` under Out of scope and its section in the fog. */
function ticketThreeClosedOutOfScope(line: string): Record<string, string> {
  const files = withManifest((m) => (ticket(m, 1).state = 'closed'));
  files['issues/1.md'] = files['issues/1.md']
    .replace('### Fog\n', '### Fog\n- Users and roles: which roles exist\n')
    .replace('### Out of scope\n', `### Out of scope\n${line}\n`);
  return files;
}

/** The valid fixture with ticket #3 blocked, in both forms, by a ticket that does not exist. */
function blockedByUnknownTicket(): Record<string, string> {
  const files = withManifest((m) => (ticket(m, 1).blockedBy = [7]));
  files['issues/3.md'] = files['issues/3.md'].replace('- #2\n', '- #7\n');
  return files;
}

/** The valid fixture with its answer marked as turned from the member comment `from`. */
function viaGitHubFrom(from: string): Record<string, string> {
  const files = validFixture();
  files['comments/2001.md'] = files['comments/2001.md'].replace('via:', 'via: github').replace('from:', `from: ${from}`);
  return files;
}

/** The valid fixture with a discussion of Q3.1 on the open ticket, and no answer to Q3.1 before it. */
function discussionWithoutAnswer(): Record<string, string> {
  const files = withManifest((m) => {
    ticket(m, 1).comments = [{ id: '3001', author: 'ada-example', createdAt: '2026-10-24T09:30:00.000Z', body: 'comments/3001.md' }];
  });
  files['comments/3001.md'] = discussionOf('', 'Q3.1');
  return files;
}

/** The valid fixture with a discussion naming a session file the Grillo folder lacks. */
function discussionFromMissingSession(): Record<string, string> {
  const files = withManifest((m) => {
    ticket(m, 0).comments = [
      ...(ticket(m, 0).comments as unknown[]),
      { id: '2003', author: 'ada-example', createdAt: '2026-10-24T09:22:00.000Z', body: 'comments/2003.md' },
    ];
  });
  files['comments/2003.md'] = discussionOf('.grillo/sessions/2026-10-24-091500.md');
  return files;
}

function discussionOf(session: string, question = 'Q2.1'): string {
  return [
    '<!-- grillo:discussion -->',
    'who: ada-example',
    'when: 2026-10-24T09:20:00.000Z',
    'sources: S1',
    'via:',
    `question: ${question}`,
    session === '' ? 'session:' : `session: ${session}`,
    '',
    'Ada: every member with a key card.',
  ].join('\n');
}

describe('readFixtureFolder', () => {
  it('reads every file under a folder by its path with forward slashes', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'grillo-fixture-'));
    try {
      for (const [path, text] of Object.entries(validFixture())) {
        await mkdir(dirname(join(folder, path)), { recursive: true });
        await writeFile(join(folder, path), text);
      }

      const files = await readFixtureFolder(folder);

      expect(Object.keys(files).sort()).toEqual(Object.keys(validFixture()).sort());
      expect(checkProjectFixture(files).tickets).toHaveLength(2);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

/** The valid fixture with open ticket #3 carrying `labels` and one tags-by-hand marker, comment 3001, written by ada-example. */
function handTagged(labels: string[], marker: string): Record<string, string> {
  const files = withManifest((m) => {
    ticket(m, 1).labels = labels;
    ticket(m, 1).comments = [{ id: '3001', author: 'ada-example', createdAt: '2026-10-25T10:00:00.000Z', body: 'comments/3001.md' }];
  });
  files['comments/3001.md'] = marker;
  return files;
}

function tagsByHandOf(who: string, when: string, domains: string): string {
  return ['<!-- grillo:tags-by-hand -->', `who: ${who}`, `when: ${when}`, domains === '' ? 'domains:' : `domains: ${domains}`, '', ''].join('\n');
}
