import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MEETING_HOLDS_FOLDER, readTicketHolds, TAB_FILE } from './holds';

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

  it('finds no holds in a session that holds nothing yet, and refuses what is no session id', async () => {
    const folder = projectWith({});

    expect(await readTicketHolds(folder, SESSION)).toEqual([]);
    await expect(readTicketHolds(folder, '../..')).rejects.toThrow("'../..' is not a session id");
  });
});
