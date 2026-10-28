// Ticket-and-question management, found by the shell's screen discovery (`@screens/*/index.ts`). Opened with
// `{ project: '<owner>/<repo>' }` (and optionally `ticket: '<issue number>'`), or with nothing for the project opened
// last on this laptop.
import type { ScreenParams, ShellContext } from '../../app/screens';
import { createStoreClient } from '../../../shared/store';
import { mountTickets } from './tickets-screen';

export const id = 'tickets';
export const title = 'Tickets';

export function mount(el: HTMLElement, params: ScreenParams, shell: ShellContext): () => void {
  return mountTickets(el, params, {
    store: createStoreClient(shell.grillo),
    grillo: shell.grillo,
    navigate: shell.navigate,
    onAgentTabs: shell.onAgentTabs,
  });
}
