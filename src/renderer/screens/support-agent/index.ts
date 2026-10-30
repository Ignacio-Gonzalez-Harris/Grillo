// The support agent tab (release 2), found by the shell's screen discovery (`@screens/*/index.ts`). When the shell
// starts it puts the Support tab first among the agent tabs and starts reading the support agent's relay requests;
// opening the tab starts the support agent with `/grillo-support` and shows it through the agent tab.
import type { ScreenParams, ShellContext } from '../../app/screens';
import { createStoreClient } from '../../../shared/store';
import { watchRelays } from './relay';
import { SUPPORT_SCREEN } from './relay-note';
import { mountSupportAgent, SUPPORT_TITLE } from './support-agent';
import { createSupportTab, type SupportTab } from './support-tab';

export const id = SUPPORT_SCREEN;
export const title = SUPPORT_TITLE;

let supportTab: SupportTab | undefined;

/** Runs once when the shell starts: the Support tab and the relay live as long as the app. */
export function start(shell: ShellContext): () => void {
  const tab = createSupportTab(shell, () => shell.navigate(id));
  const stopRelays = watchRelays(shell.grillo, shell);
  supportTab = tab;
  return () => {
    stopRelays();
    tab.dispose();
    if (supportTab === tab) supportTab = undefined;
  };
}

export function mount(el: HTMLElement, params: ScreenParams, shell: ShellContext): () => void {
  supportTab?.setActive(true);
  const close = mountSupportAgent(el, params, {
    store: createStoreClient(shell.grillo),
    grillo: shell.grillo,
    navigate: shell.navigate,
  });
  return () => {
    close();
    supportTab?.setActive(false);
  };
}
