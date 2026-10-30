import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '../../../shared/agents';
import { MEETING_HOLDS_FOLDER, QUESTION_FILE, readTicketHolds, releaseHoldsOf, releasingHoldsOfStoppedTabs, TAB_FILE } from './holds';

// Made-up session ids and tab ids only. The skill's own test checks these readings against the commands it runs.
const SESSION = '2026-10-30-140000';

let project: string | undefined;
afterEach(() => {
  if (project) rmSync(project, { recursive: true, force: true });
  project = undefined;
});

function projectWith(holds: Record<string, string | null>): string {
  project = mkdtempSync(join(tmpdir(), 'grillo-holds-'));
  for (const [entry, tab] of Object.entries(holds)) {
    const folder = join(project, MEETING_HOLDS_FOLDER, SESSION, entry);
    mkdirSync(folder, { recursive: true });
    if (tab !== null) writeFileSync(join(folder, TAB_FILE), tab);
  }
  return project;
}

describe('reading the tickets a live session holds', () => {
  it('reads only ticket folders whose tab file names a tab', async () => {
    const folder = projectWith({ '3': 'tab-1\n', '8': '', '12': null, notes: 'tab-2', '0': 'tab-3', '07': 'tab-4' });

    const holds = await readTicketHolds(folder, SESSION);

    expect(holds.map(({ ticket, agentId }) => ({ ticket, agentId }))).toEqual([{ ticket: 3, agentId: 'tab-1' }]);
    expect(holds[0].heldAt).toBeGreaterThan(0);
  });

  it.each([
    ['one of three', '1 of 3', { at: 1, of: 3 }],
    ['a line break after it', '2 of 3\n', { at: 2, of: 3 }],
    ['Windows line break', '3 of 3\r\n', { at: 3, of: 3 }],
    ['no file yet', null, undefined],
    ['an empty file', '', undefined],
    ['words', 'the second one', undefined],
    ['no total', '2 of', undefined],
    ['question zero', '0 of 3', undefined],
    ['a total of zero', '0 of 0', undefined],
    ['more than the total', '4 of 3', undefined],
    ['a negative number', '-1 of 3', undefined],
    ['leading zeros', '01 of 3', undefined],
    ['a fraction', '1.5 of 3', undefined],
    ['a second line', '1 of 3\n2 of 3', undefined],
    ['a number too big to count', `1 of ${'9'.repeat(400)}`, undefined],
  ])('reads the question at hand from its question file, leaving out anything malformed: %s', async (_case, written, question) => {
    const folder = projectWith({ '3': 'tab-1' });
    if (written !== null) writeFileSync(join(folder, MEETING_HOLDS_FOLDER, SESSION, '3', QUESTION_FILE), written);

    const [hold] = await readTicketHolds(folder, SESSION);

    expect(hold.ticket).toBe(3);
    expect(hold.question).toEqual(question);
  });

  it('finds no holds in a session that holds nothing yet, and refuses what is no session id', async () => {
    const folder = projectWith({});

    expect(await readTicketHolds(folder, SESSION)).toEqual([]);
    await expect(readTicketHolds(folder, '../..')).rejects.toThrow("'../..' is not a session id");
  });
});

describe('letting go of the holds of a tab that stopped', () => {
  const OUTSIDE_A_SESSION = 'no-session';
  const LEFT_MARKS = 'left';

  /** Every folder under the holds folder, as `<session>/<entry>[/<entry>]`, sorted. */
  function heldFolders(folder: string): string[] {
    const root = join(folder, MEETING_HOLDS_FOLDER);
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
      .sort();
  }

  function holdIn(folder: string, session: string, entry: string, tab: string | null): void {
    const hold = join(folder, MEETING_HOLDS_FOLDER, session, entry);
    mkdirSync(hold, { recursive: true });
    if (tab !== null) writeFileSync(join(hold, TAB_FILE), tab);
  }

  it('lets go of every ticket the tab held, in a session or outside one, and nothing any other tab holds', () => {
    const folder = projectWith({ '3': 'tab-1\n', '8': 'tab-2', '12': null, notes: 'tab-1' });
    holdIn(folder, OUTSIDE_A_SESSION, '5', 'tab-1');
    holdIn(folder, OUTSIDE_A_SESSION, '6', 'tab-3');
    holdIn(folder, SESSION, `${LEFT_MARKS}/3`, null);

    const released = releaseHoldsOf(folder, 'tab-1');

    expect(released.sort((a, b) => a.ticket - b.ticket)).toEqual([
      { session: SESSION, ticket: 3 },
      { session: OUTSIDE_A_SESSION, ticket: 5 },
    ]);
    expect(heldFolders(folder)).toEqual([
      SESSION,
      `${SESSION}/12`,
      `${SESSION}/8`,
      `${SESSION}/left`,
      `${SESSION}/left/3`,
      `${SESSION}/notes`,
      OUTSIDE_A_SESSION,
      `${OUTSIDE_A_SESSION}/6`,
    ]);
  });

  it.each([
    ['an empty tab id', ''],
    ['a blank tab id', '  \n'],
    ['a tab id with a path in it', '../tab-1'],
  ])('lets go of nothing for %s, even beside holds with an empty tab file', (_what, agentId) => {
    const folder = projectWith({ '3': '', '4': '\n', '8': 'tab-1' });

    expect(releaseHoldsOf(folder, agentId)).toEqual([]);
    expect(heldFolders(folder)).toEqual([SESSION, `${SESSION}/3`, `${SESSION}/4`, `${SESSION}/8`]);
  });

  it('lets go of nothing, and never throws, in a project folder whose holds are missing or the wrong shape', () => {
    const empty = projectWith({});
    expect(releaseHoldsOf(empty, 'tab-1')).toEqual([]);
    expect(releaseHoldsOf(join(empty, 'no-such-folder'), 'tab-1')).toEqual([]);

    const odd = projectWith({ '3': 'tab-1' });
    writeFileSync(join(odd, MEETING_HOLDS_FOLDER, 'a-file-not-a-session'), 'tab-1');
    writeFileSync(join(odd, MEETING_HOLDS_FOLDER, SESSION, '9'), 'tab-1');
    mkdirSync(join(odd, MEETING_HOLDS_FOLDER, SESSION, '10', TAB_FILE), { recursive: true });
    expect(releaseHoldsOf(odd, 'tab-1')).toEqual([{ session: SESSION, ticket: 3 }]);
    expect(heldFolders(odd)).toEqual([SESSION, `${SESSION}/10`, `${SESSION}/10/tab`]);
  });

  it('when the holds folder is itself a file, lets go of nothing', () => {
    const folder = projectWith({});
    mkdirSync(join(folder, '.git'));
    writeFileSync(join(folder, MEETING_HOLDS_FOLDER), 'tab-1');

    expect(releaseHoldsOf(folder, 'tab-1')).toEqual([]);
  });
});

describe('watching for tabs that stop', () => {
  const agent = (id: string, folder: string): AgentInfo => ({ id, kind: 'grilling', title: 'Grilling · Live session', folder, waiting: false });

  it('lets go once of the holds of each tab that left the list, in its own project folder', () => {
    const release = vi.fn<(folder: string, agentId: string) => void>();
    const listChanged = releasingHoldsOfStoppedTabs(release, vi.fn());

    listChanged([agent('tab-1', '/made-up/garden')]);
    listChanged([agent('tab-1', '/made-up/garden'), agent('tab-2', '/made-up/shed')]);
    listChanged([agent('tab-2', '/made-up/shed')]);
    listChanged([agent('tab-2', '/made-up/shed')]);
    listChanged([]);

    expect(release.mock.calls).toEqual([
      ['/made-up/garden', 'tab-1'],
      ['/made-up/shed', 'tab-2'],
    ]);
  });

  it('reports a release that fails and still lets go of the other stopped tabs', () => {
    const warn = vi.fn();
    const release = vi.fn((_folder: string, agentId: string) => {
      if (agentId === 'tab-1') throw new Error('made-up disk failure');
    });
    const listChanged = releasingHoldsOfStoppedTabs(release, warn);

    listChanged([agent('tab-1', '/made-up/garden'), agent('tab-2', '/made-up/garden')]);
    expect(() => listChanged([])).not.toThrow();

    expect(release.mock.calls.map(([, id]) => id)).toEqual(['tab-1', 'tab-2']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('made-up disk failure'));
  });
});
