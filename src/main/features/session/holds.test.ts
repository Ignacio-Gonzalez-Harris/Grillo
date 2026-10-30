import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MEETING_HOLDS_FOLDER, QUESTION_FILE, readTicketHolds, TAB_FILE } from './holds';

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
