/**
 * The small "setup finished" setting on this laptop (PRD section 4.1 item 5), kept in the settings store: stored when
 * Continue is pressed with everything green, read when Grillo starts. Anything but the stored value counts as a first
 * launch, because Setup is the safe place to land.
 */
import type { GrilloApi } from '../../../shared/ipc';

const SETUP_FINISHED_KEY = 'setupFinished';
const SETUP_FINISHED = true;

export async function readSetupFinished(grillo: GrilloApi): Promise<boolean> {
  try {
    const stored: unknown = await grillo.invoke('settings:get', { key: SETUP_FINISHED_KEY, defaultValue: !SETUP_FINISHED });
    return stored === SETUP_FINISHED;
  } catch (error) {
    console.warn('Grillo could not read whether setup is finished; it opens on Setup.', error);
    return false;
  }
}

/** Never fails: a setting that could not be stored only means Setup opens again on the next start. */
export async function storeSetupFinished(grillo: GrilloApi): Promise<void> {
  try {
    await grillo.invoke('settings:set', { key: SETUP_FINISHED_KEY, value: SETUP_FINISHED });
  } catch (error) {
    console.warn('Grillo could not store that setup is finished; it opens on Setup next time.', error);
  }
}
