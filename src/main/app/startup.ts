/** What a failed start-up needs from Electron: the system's error dialog, and a way to quit. */
export interface StartupFailureHandler {
  showError(title: string, content: string): void;
  quit(): void;
}

export const STARTUP_FAILED_TITLE = 'Grillo could not start';

const UNKNOWN_REASON = 'An unknown error stopped it.';
const CLOSING_NOTE = 'Grillo will close now. Start it again, and if this keeps happening, pass this message on.';

function reasonOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return UNKNOWN_REASON;
}

/** The text of the error dialog: the reason first, then what happens next. */
export function startupFailureMessage(error: unknown): string {
  return `${reasonOf(error)}\n\n${CLOSING_NOTE}`;
}

/**
 * Runs Grillo's start-up. An error it throws is shown in the system's error dialog and Grillo quits, so a failed
 * start never leaves a process running with no window, which the member could only end in Task Manager.
 */
export async function startOrQuit(
  start: () => unknown,
  onFailure: StartupFailureHandler,
  log: (message: string, error: unknown) => void = console.error,
): Promise<void> {
  try {
    await start();
  } catch (error) {
    log('Grillo could not start.', error);
    onFailure.showError(STARTUP_FAILED_TITLE, startupFailureMessage(error));
    onFailure.quit();
  }
}
