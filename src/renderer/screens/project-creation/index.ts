// Project creation and invites, found by the shell's screen discovery (`@screens/*/index.ts`). Opened with no params
// it lists projects and invitations; opened with `{ project: '<owner>/<repo>' }` it edits that project's structure.
import type { ScreenParams, ShellContext } from '../../app/screens';
import { createStoreClient } from '../../../shared/store';
import { mountProjectCreation } from './project-creation';

export const id = 'project-creation';
export const title = 'Project creation and invites';

export function mount(el: HTMLElement, params: ScreenParams, shell: ShellContext): () => void {
  return mountProjectCreation(el, params, {
    store: createStoreClient(shell.grillo),
    grillo: shell.grillo,
    navigate: shell.navigate,
  });
}
