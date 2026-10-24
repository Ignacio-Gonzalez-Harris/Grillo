import type { GitHubIdentity, IdentityFailure } from '../../../shared/tools';
import type { ProcessRunner } from './process-runner';

/** The one error `identity()` throws; `reason` says what the member must do about it. */
export class IdentityError extends Error {
  constructor(readonly reason: IdentityFailure) {
    super(`Could not read the GitHub identity: ${reason}`);
    this.name = 'IdentityError';
  }
}

/** gh's own exit code for "you must sign in first". */
const GH_AUTH_REQUIRED_EXIT = 4;
/** GitHub refused the stored sign-in (revoked or expired). */
const UNAUTHORIZED = /HTTP 401/;

type JsonObject = Record<string, unknown>;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The primary address. GitHub lists it only to a sign-in allowed to read it; null otherwise. */
async function primaryEmail(runner: ProcessRunner): Promise<string | null> {
  const result = await runner.run('gh', ['api', 'user/emails']);
  if (!result.found || result.exitCode !== 0) return null;
  const emails = parseJson(result.stdout);
  if (!Array.isArray(emails)) return null;
  for (const entry of emails) {
    const email = isObject(entry) && entry['primary'] === true ? nonEmptyText(entry['email']) : null;
    if (email) return email;
  }
  return null;
}

export interface IdentityReader {
  identity(): Promise<GitHubIdentity>;
}

/** Reads who the member is through their own `gh` sign-in; Grillo never sees the token (PRD section 7). */
export function createIdentityReader(runner: ProcessRunner): IdentityReader {
  return {
    async identity() {
      const result = await runner.run('gh', ['api', 'user']);
      if (!result.found) throw new IdentityError('not-installed');
      if (result.exitCode === GH_AUTH_REQUIRED_EXIT || UNAUTHORIZED.test(result.stderr)) {
        throw new IdentityError('signed-out');
      }
      const user = result.exitCode === 0 ? parseJson(result.stdout) : undefined;
      const login = isObject(user) ? nonEmptyText(user['login']) : null;
      if (!isObject(user) || !login) throw new IdentityError('failed');
      return {
        login,
        name: nonEmptyText(user['name']),
        email: nonEmptyText(user['email']) ?? (await primaryEmail(runner)),
      };
    },
  };
}
