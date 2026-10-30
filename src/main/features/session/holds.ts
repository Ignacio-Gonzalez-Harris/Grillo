/**
 * The tickets the grilling agents of a live session hold on this laptop (`grillo-meeting`, "Holding a ticket in this
 * session"): one folder per ticket under `.git/meeting-holds/<session id>/`, its `tab` file naming the agent's tab
 * (the agent is started with `GRILLO_AGENT_ID`). The meeting screen reads them to title each tab after its ticket.
 */
import type { Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId } from '../../../shared/agents';
import { isSessionId } from '../../store/github/repo/names';

export const MEETING_HOLDS_FOLDER = join('.git', 'meeting-holds');
export const TAB_FILE = 'tab';
const TICKET_NUMBER = /^[1-9]\d*$/;

export interface TicketHold {
  ticket: number;
  agentId: AgentId;
  /** When the hold's tab file was written, in milliseconds: the newest is the agent's ticket at hand. */
  heldAt: number;
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Undefined when the file is not there (yet, or any more): a hold being made or let go of names no tab. */
async function readIfThere<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function holdIn(sessionFolder: string, entry: string): Promise<TicketHold | undefined> {
  if (!TICKET_NUMBER.test(entry)) return undefined;
  const tab = join(sessionFolder, entry, TAB_FILE);
  const [agentId, written] = await Promise.all([
    readIfThere(() => readFile(tab, 'utf8')),
    readIfThere<Stats>(() => stat(tab)),
  ]);
  const id = agentId?.trim();
  if (id === undefined || id === '' || written === undefined) return undefined;
  return { ticket: Number(entry), agentId: id, heldAt: written.mtimeMs };
}

/** Every ticket held in the session whose tab file names a tab; none when the session holds nothing yet. */
export async function readTicketHolds(projectFolder: string, sessionId: string): Promise<TicketHold[]> {
  if (!isSessionId(sessionId)) throw new Error(`'${sessionId}' is not a session id`);
  const sessionFolder = join(projectFolder, MEETING_HOLDS_FOLDER, sessionId);
  const entries = (await readIfThere(() => readdir(sessionFolder))) ?? [];
  const holds = await Promise.all(entries.map((entry) => holdIn(sessionFolder, entry)));
  return holds.filter((hold): hold is TicketHold => hold !== undefined);
}
