// The generic agent tab, found by the shell's screen discovery (`@screens/*/index.ts`). The shell's "+" opens it with
// no parameters (the project opened last); a screen may open it with `{ project: '<owner>/<repo>' }`.
import type { ScreenParams, ShellContext } from '../../app/screens';
import { createStoreClient } from '../../../shared/store';
import { mountGenericAgent } from './generic-agent';

export const id = 'generic-agent';
export const title = 'Generic agent';

export function mount(el: HTMLElement, params: ScreenParams, shell: ShellContext): () => void {
  return mountGenericAgent(el, params, {
    store: createStoreClient(shell.grillo),
    grillo: shell.grillo,
    navigate: shell.navigate,
  });
}
