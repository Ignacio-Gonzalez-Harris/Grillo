// The map and its tickets, found by the shell's screen discovery (`@screens/*/index.ts`). Opened with
// `{ project: '<owner>/<repo>' }`, or with nothing for the project opened last on this laptop.
import type { ScreenParams, ShellContext } from '../../app/screens';
import { createStoreClient } from '../../../shared/store';
import { meetingAgents } from '../meeting/meeting-agents';
import { mountMap } from './map-screen';

export const id = 'map';
export const title = 'Map';

export function mount(el: HTMLElement, params: ScreenParams, shell: ShellContext): () => void {
  return mountMap(el, params, {
    store: createStoreClient(shell.grillo),
    grillo: shell.grillo,
    navigate: shell.navigate,
    onAgentTabs: shell.onAgentTabs,
    meetingAgents,
  });
}
