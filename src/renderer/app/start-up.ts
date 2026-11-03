import type { GrilloApi } from '../../shared/ipc';
import { isAllGreen } from '../screens/setup-check/requirements';
import { runSetupCheck } from '../screens/setup-check/run-check';
import { readSetupFinished } from '../screens/setup-check/setup-finished';
import { PROJECT_SCREEN, START_SCREEN } from './navigation';

/**
 * The screen Grillo opens on (PRD section 4.1 item 5). A first launch opens Setup. A later start runs the setup check's
 * own check, with `showChecking` called first: everything green opens Project, anything else opens Setup. The setting
 * stays stored after a failing start, so the next passing start opens Project again. Never fails.
 */
export async function chooseStartScreen(grillo: GrilloApi, showChecking: () => void): Promise<string> {
  if (!(await readSetupFinished(grillo))) return START_SCREEN;
  showChecking();
  return isAllGreen(await runSetupCheck(grillo, false)) ? PROJECT_SCREEN : START_SCREEN;
}
