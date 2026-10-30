/**
 * The tickets the grilling agents hold on this laptop: one folder per ticket under `.git/meeting-holds/<session id>/`
 * (`grillo-meeting`, "Holding a ticket in this session"), or under `.git/meeting-holds/no-session/` outside a live
 * session (`grillo-wayfinder`, "Holding a ticket on this laptop"), its `tab` file naming the agent's tab (the agent is
 * started with `GRILLO_AGENT_ID`). The meeting screen reads them to title each tab after its ticket, and Grillo lets
 * go of a tab's holds once the tab stops, since its agent never will.
 */
import type { Dirent, Stats } from 'node:fs';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, AgentInfo } from '../../../shared/agents';
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

/** One hold let go of: the session folder it was in (`no-session` outside a session) and its ticket. */
export interface ReleasedHold {
  session: string;
  ticket: number;
}

/** The folders in a folder; none when it is missing or is no folder. */
function foldersIn(folder: string): Dirent[] {
  try {
    return readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
}

/** The trimmed text of a hold's tab file, or undefined when it cannot be read as a file. */
function tabOf(hold: string): string | undefined {
  try {
    return readFileSync(join(hold, TAB_FILE), 'utf8').trim();
  } catch {
    return undefined;
  }
}

/**
 * Lets go of every ticket the tab holds in the project folder, in every session folder and outside a session: its
 * agent has stopped, so it never will. Only holds whose tab file names exactly this tab go; a hold being made (no tab
 * file yet) and the session's marks of tickets left with questions open stay. Synchronous, so it finishes even while
 * the app quits.
 */
export function releaseHoldsOf(projectFolder: string, agentId: AgentId): ReleasedHold[] {
  const id = agentId.trim();
  if (id === '' || id !== agentId) return [];
  const root = join(projectFolder, MEETING_HOLDS_FOLDER);
  const released: ReleasedHold[] = [];
  for (const session of foldersIn(root)) {
    const sessionFolder = join(root, session.name);
    for (const entry of foldersIn(sessionFolder)) {
      const hold = join(sessionFolder, entry.name);
      if (!TICKET_NUMBER.test(entry.name) || tabOf(hold) !== id) continue;
      rmSync(hold, { recursive: true, force: true });
      released.push({ session: session.name, ticket: Number(entry.name) });
    }
  }
  return released;
}

/**
 * Watches the list of running agents and lets go of the holds of each tab that left it (stopped by the member, ended
 * on its own, or stopped as the app quits), in that tab's project folder. A release that fails is reported, never
 * thrown into the agent runtime that announced the list.
 */
export function releasingHoldsOfStoppedTabs(
  release: (projectFolder: string, agentId: AgentId) => unknown,
  warn: (message: string) => void,
): (list: readonly AgentInfo[]) => void {
  let running = new Map<AgentId, string>();
  return (list) => {
    const now = new Map(list.map((agent) => [agent.id, agent.folder] as const));
    for (const [id, folder] of running) {
      if (now.has(id)) continue;
      try {
        release(folder, id);
      } catch (error) {
        warn(`Grillo could not let go of the tickets the stopped tab ${id} held: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    running = now;
  };
}
