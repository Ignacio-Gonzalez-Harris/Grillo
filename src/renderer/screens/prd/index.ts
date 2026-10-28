// The PRD view, found by the shell's screen discovery (`@screens/*/index.ts`). The PRD tab opens it with no
// parameters (the project opened last); a screen may open it with `{ project: '<owner>/<repo>' }`.
import type { ScreenParams, ShellContext } from '../../app/screens';
import { createStoreClient } from '../../../shared/store';
import { saveFile } from './export';
import { mountPrdView } from './prd-view';

export const id = 'prd';
export const title = 'PRD';

export function mount(el: HTMLElement, params: ScreenParams, shell: ShellContext): () => void {
  return mountPrdView(el, params, {
    store: createStoreClient(shell.grillo),
    grillo: shell.grillo,
    navigate: shell.navigate,
    onAgents: shell.onAgentTabs,
    save: saveFile,
  });
}
