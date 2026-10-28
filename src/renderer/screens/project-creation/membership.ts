/**
 * The member's own role and domains, pre-filled from the last project they joined (PRD section 4.2 item 3). The
 * settings file keeps them under one key, written each time the member saves their role and domains here.
 */
import type { ProjectId } from '../../../main/store/types';
import type { GrilloApi } from '../../../shared/ipc';
import type { SettingValue } from '../../../shared/store';

/** The settings key: `{ "project": "<owner>/<repo>", "role": "<free text>", "domains": ["<domain>", …] }`. */
export const LAST_MEMBERSHIP_KEY = 'lastMembership';

export interface Membership {
  role: string;
  domains: string[];
}

export interface LastMembership extends Membership {
  project: ProjectId;
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** The last membership saved, or null when there is none or the settings file holds something else there. */
export async function readLastMembership(grillo: GrilloApi): Promise<LastMembership | null> {
  const stored: unknown = await grillo.invoke('settings:get', { key: LAST_MEMBERSHIP_KEY, defaultValue: null });
  const candidate = stored as Partial<Record<keyof LastMembership, unknown>> | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    !isText(candidate.project) ||
    !isText(candidate.role) ||
    !Array.isArray(candidate.domains)
  ) {
    return null;
  }
  return { project: candidate.project, role: candidate.role, domains: cleanDomains(candidate.domains.filter(isText)) };
}

export async function saveLastMembership(grillo: GrilloApi, last: LastMembership): Promise<void> {
  const value: SettingValue = { project: last.project, role: last.role, domains: [...last.domains] };
  await grillo.invoke('settings:set', { key: LAST_MEMBERSHIP_KEY, value });
}

/** Domains trimmed, blanks dropped, each once (the first spelling wins, compared without regard to case). */
export function cleanDomains(domains: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const domain of domains.map((entry) => entry.trim())) {
    const key = domain.toLowerCase();
    if (domain === '' || seen.has(key)) continue;
    seen.add(key);
    kept.push(domain);
  }
  return kept;
}
