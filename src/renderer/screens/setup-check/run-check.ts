/**
 * The setup check itself: asks the tools feature about Claude Code and `gh`, then reads who the member is on GitHub.
 * The setup check screen and the start-up decision both run this one check, and `isAllGreen` reads its answer for both.
 */
import type { GrilloApi } from '../../../shared/ipc';
import type { IdentityResult } from '../../../shared/tools';
import { readIdentity, readToolsReport } from './answers';
import type { CheckView } from './requirements';

async function readAccount(grillo: GrilloApi, ghReady: boolean): Promise<IdentityResult | null> {
  if (!ghReady) return null;
  try {
    return readIdentity(await grillo.invoke('tools:identity', undefined));
  } catch (error) {
    console.warn('Grillo could not read the GitHub identity.', error);
    return { ok: false, reason: 'failed' };
  }
}

/** Never fails: a check that itself fails is the `failed` view. `force` skips the tools feature's short cache. */
export async function runSetupCheck(grillo: GrilloApi, force: boolean): Promise<CheckView> {
  try {
    const report = readToolsReport(await grillo.invoke('tools:check', { force }));
    const identity = await readAccount(grillo, report.gh.installed && report.gh.signedIn);
    return { phase: 'done', report, identity };
  } catch (error) {
    console.warn('Grillo could not check the tools.', error);
    return { phase: 'failed' };
  }
}
