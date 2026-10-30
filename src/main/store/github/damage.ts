import { GhError } from '../gh';
import { StoreError } from '../store';

/**
 * Why a record in a list cannot be read: a file or issue not in the format Grillo writes, or a project folder that
 * cannot be brought up to date. The list flags that one item and goes on (types.ts, `Damage`). Anything else (gh
 * not signed in or unreachable, a bug) is no damage of one record and is thrown again, failing the list as before.
 */
export function damageOf(error: unknown): string {
  const damaged = error instanceof StoreError && !(error instanceof GhError) && (error.kind === 'backend' || error.kind === 'conflict');
  if (!damaged) {
    throw error;
  }
  return error.message;
}
