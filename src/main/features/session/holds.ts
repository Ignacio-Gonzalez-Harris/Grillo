/**
 * The tickets the grilling agents of a live session hold on this laptop (`grillo-meeting`, "Holding a ticket in this
 * session"): one folder per ticket under `.git/meeting-holds/<session id>/`, its `tab` file naming the agent's tab
 * (the agent is started with `GRILLO_AGENT_ID`), its `question` file saying which question the agent asks
 * (`resources/skills/README.md`, Agent-to-screen protocol). The meeting screen reads them to title each tab after its
 * ticket and to fill the question card.
 */
import type { Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId } from '../../../shared/agents';
import { isSessionId } from '../../store/github/repo/names';

export const MEETING_HOLDS_FOLDER = join('.git', 'meeting-holds');
export const TAB_FILE = 'tab';
export const QUESTION_FILE = 'question';
const TICKET_NUMBER = /^[1-9]\d*$/;
/** The question file's one line, `<n> of <m>`; a line break after it is allowed, as a shell may write one. */
const QUESTION_LINE = /^([1-9]\d*) of ([1-9]\d*)\s*$/;

export interface TicketHold {
  ticket: number;
  agentId: AgentId;
  /** When the hold's tab file was written, in milliseconds: the newest is the agent's ticket at hand. */
  heldAt: number;
  /** The question the agent says it asks, when its question file holds one the screen can show. */
  question?: { at: number; of: number };
}

/** The agent writes this file, so anything but a sensible `<n> of <m>` counts as nothing having been said. */
function questionFrom(line: string | undefined): TicketHold['question'] {
  const match = QUESTION_LINE.exec(line ?? '');
  if (match === null) return undefined;
  const [at, of] = [Number(match[1]), Number(match[2])];
  return Number.isSafeInteger(of) && at <= of ? { at, of } : undefined;
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
  const [agentId, written, question] = await Promise.all([
    readIfThere(() => readFile(tab, 'utf8')),
    readIfThere<Stats>(() => stat(tab)),
    readIfThere(() => readFile(join(sessionFolder, entry, QUESTION_FILE), 'utf8')),
  ]);
  const id = agentId?.trim();
  if (id === undefined || id === '' || written === undefined) return undefined;
  const asked = questionFrom(question);
  return { ticket: Number(entry), agentId: id, heldAt: written.mtimeMs, ...(asked ? { question: asked } : {}) };
}

/** Every ticket held in the session whose tab file names a tab; none when the session holds nothing yet. */
export async function readTicketHolds(projectFolder: string, sessionId: string): Promise<TicketHold[]> {
  if (!isSessionId(sessionId)) throw new Error(`'${sessionId}' is not a session id`);
  const sessionFolder = join(projectFolder, MEETING_HOLDS_FOLDER, sessionId);
  const entries = (await readIfThere(() => readdir(sessionFolder))) ?? [];
  const holds = await Promise.all(entries.map((entry) => holdIn(sessionFolder, entry)));
  return holds.filter((hold): hold is TicketHold => hold !== undefined);
}
