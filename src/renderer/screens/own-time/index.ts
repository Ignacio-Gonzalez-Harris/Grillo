// Own-time answering, found by the shell's screen discovery (`@screens/*/index.ts`). Opened with
// `{ project: '<owner>/<repo>', ticket: '<issue number>' }`; its agent variant is the panel in tab-panel.ts.
import type { ScreenParams, ShellContext } from '../../app/screens';
import { createStoreClient } from '../../../shared/store';
import { OWN_TIME_SCREEN } from './agent-panel';
import { ownTimeAgents } from './agents';
import { mountOwnTime } from './own-time';

export const id = OWN_TIME_SCREEN;
export const title = 'Own-time answering';

export function mount(el: HTMLElement, params: ScreenParams, shell: ShellContext): () => void {
  return mountOwnTime(el, params, {
    store: createStoreClient(shell.grillo),
    grillo: shell.grillo,
    agents: ownTimeAgents,
    navigate: shell.navigate,
  });
}
