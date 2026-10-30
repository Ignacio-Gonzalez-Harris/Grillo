/**
 * Grilling agents whose first start was refused, kept in the settings file so the start can be tried again after the
 * member left the creation screen, or closed Grillo (PRD section 4.2). An entry goes as soon as the agent starts.
 */
import type { IsoDateTime, ProjectId } from '../../../main/store/types';
import type { GrilloApi } from '../../../shared/ipc';
import type { SettingValue } from '../../../shared/store';

/** The settings key: a list of `UnstartedAgent`. */
export const UNSTARTED_AGENTS_KEY = 'unstartedGrillingAgents';

export interface UnstartedAgent {
  project: ProjectId;
  firstMessage: string;
  title: string;
  /** Why the start was refused. */
  error: string;
  /** When it was first refused: the project was created then, and the list says so. */
  at: IsoDateTime;
}

const TEXT_FIELDS: readonly (keyof UnstartedAgent)[] = ['project', 'firstMessage', 'title', 'error', 'at'];

function isUnstartedAgent(value: unknown): value is UnstartedAgent {
  const entry = value as Partial<Record<keyof UnstartedAgent, unknown>> | null;
  return TEXT_FIELDS.every((name) => typeof entry?.[name] === 'string');
}

/** Every refused start; anything else the settings file holds there is ignored. */
export async function readUnstartedAgents(grillo: GrilloApi): Promise<UnstartedAgent[]> {
  const stored: unknown = await grillo.invoke('settings:get', { key: UNSTARTED_AGENTS_KEY, defaultValue: [] });
  return Array.isArray(stored) ? stored.filter(isUnstartedAgent) : [];
}

async function write(grillo: GrilloApi, entries: UnstartedAgent[]): Promise<void> {
  const value: SettingValue = entries.map((entry) => ({ ...entry }));
  await grillo.invoke('settings:set', { key: UNSTARTED_AGENTS_KEY, value });
}

/** A later refusal of the same project replaces the earlier one's reason, and keeps its date. */
export async function rememberUnstartedAgent(grillo: GrilloApi, unstarted: UnstartedAgent): Promise<void> {
  const entries = await readUnstartedAgents(grillo);
  const earlier = entries.find(({ project }) => project === unstarted.project);
  const others = entries.filter((entry) => entry !== earlier);
  await write(grillo, [{ ...unstarted, at: earlier?.at ?? unstarted.at }, ...others]);
}

export async function forgetUnstartedAgent(grillo: GrilloApi, project: ProjectId): Promise<void> {
  const entries = await readUnstartedAgents(grillo);
  const others = entries.filter((entry) => entry.project !== project);
  if (others.length !== entries.length) await write(grillo, others);
}
