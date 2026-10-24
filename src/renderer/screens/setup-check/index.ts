// The setup check screen, found by the shell's screen discovery (`@screens/*/index.ts`).
import type { ScreenParams, ShellContext } from '../../app/screens';
import { mountSetupCheck } from './setup-check';

export const id = 'setup-check';
export const title = 'Setup check';

export function mount(el: HTMLElement, _params: ScreenParams, shell: ShellContext): () => void {
  return mountSetupCheck(el, shell);
}
