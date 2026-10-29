// The chat view, found by the shell's screen discovery (`@screens/*/index.ts`) only so it can start with the shell:
// from then on its log hears every chat agent, so a tab's chat shows the messages sent before the tab appeared. The
// chat itself is each agent tab's body (`tab-panel.ts`); this screen has nothing of its own to show.
import type { ShellContext } from '../../app/screens';
import { glassPanel } from '../../theme/components';
import { appChatLog, stopAppChatLog } from './chat-log';

export const id = 'chat-view';
export const title = 'Chat';

export function start(shell: ShellContext): () => void {
  appChatLog(shell.grillo);
  return stopAppChatLog;
}

export function mount(el: HTMLElement): void {
  const message = document.createElement('p');
  message.className = 'muted';
  message.textContent = "Each agent's chat shows in its own tab: click the agent's name on the tab bar.";
  el.append(glassPanel([message]));
}
