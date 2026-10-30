/**
 * The save notice (prototype `screen-project-creation`, state `save-notice`; PRD section 4.2, "How saves reach main
 * follows the repository's own rules"): when a save reaches a repository whose main branch is protected, it becomes a
 * pull request, and a note above the open screen names it until the member dismisses it. Saves come from any screen
 * and from agents, so the shell shows the note, above whichever screen the save was made on.
 */
import type { PullRequestNotice } from '../../main/store/store';
import type { GrilloApi } from '../../shared/ipc';
import { PULL_REQUEST_CHANNEL } from '../../shared/store';
import { button } from '../theme/components';

export interface SaveNotice {
  /** The notes, placed above the screen; empty while there is nothing to tell. */
  root: HTMLElement;
  dispose(): void;
}

const PULL_NUMBER = /\/pull\/(\d+)$/;
const WEB_ADDRESS = /^https:\/\//;

/** The notice as the main process sent it, or null when it is not one. */
function readNotice(value: unknown): PullRequestNotice | null {
  const notice = value as Partial<Record<keyof PullRequestNotice, unknown>> | null;
  if (typeof notice !== 'object' || notice === null) return null;
  const { project, url, title } = notice;
  if (typeof project !== 'string' || typeof url !== 'string' || typeof title !== 'string' || !WEB_ADDRESS.test(url)) return null;
  return { project, url, title };
}

function textOf({ project, url, title }: PullRequestNotice): string {
  const number = PULL_NUMBER.exec(url)?.[1];
  const which = number === undefined ? 'a pull request' : `pull request #${number}`;
  return (
    `Saved as ${which}, "${title}". The main branch of ${project} is protected, so the change reaches the project ` +
    'once someone merges that pull request.'
  );
}

export function createSaveNotice(grillo: GrilloApi): SaveNotice {
  const root = document.createElement('div');
  root.className = 'save-notices';
  /**
   * Every pull request already told, shown or dismissed: one note per pull request, oldest first. A later save added
   * to the same pull request (a live session's transcript, say) changes nothing on screen, and a dismissed note stays
   * dismissed.
   */
  const told = new Set<string>();

  function show(notice: PullRequestNotice): void {
    if (told.has(notice.url)) return;
    told.add(notice.url);
    const message = document.createElement('span');
    message.className = 'grow';
    message.textContent = textOf(notice);
    const link = document.createElement('a');
    link.className = 'btn sm';
    link.href = notice.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'Open on GitHub';
    const note = document.createElement('div');
    note.className = 'note row';
    note.setAttribute('role', 'status');
    const dismiss = button('Dismiss', {
      small: true,
      onClick: () => note.remove(),
    });
    note.append(message, link, dismiss);
    root.append(note);
  }

  const stopListening = grillo.on(PULL_REQUEST_CHANNEL, (payload) => {
    const notice = readNotice(payload);
    if (notice !== null) show(notice);
  });

  return { root, dispose: stopListening };
}
