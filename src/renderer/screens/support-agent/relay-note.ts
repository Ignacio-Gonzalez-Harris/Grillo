/**
 * The relay's third state (prototype `screen-support-agent-tab`, "Relayed, seen in the target tab"; PRD section 4.6
 * item 7): when a relayed message reaches an agent's chat, that agent's tab says so in its right-hand column, with the
 * way back to Support. The message itself is the signal, so the note and the bubble's badge can never disagree.
 */
import './support-agent.css';
import { readRelayMark, type ChatMessage } from '../../../shared/agent-chat';
import { AGENT_KINDS, type AgentInfo } from '../../../shared/agents';
import { AGENT_SCREEN } from '../../app/navigation';
import { button } from '../../theme/components';
import type { TabPanel } from '../agent-tab/tab-panels';
import { el, note } from '../own-time/view';

/** The Support tab's screen id. */
export const SUPPORT_SCREEN = 'support-agent';
export const RELAYED_HINT = 'The reply shows in that tab only. The support agent says a message went through only once Grillo confirms it.';
/** Below the own-time questions, which come first in the column. */
const RELAY_NOTE_PRIORITY = 5;

export function relayNotePanel(): TabPanel {
  return {
    kinds: AGENT_KINDS.filter((kind) => kind !== 'support'),
    slot: 'aside',
    priority: RELAY_NOTE_PRIORITY,
    mount(container, { agent, grillo, shell }) {
      let tabs: readonly AgentInfo[] = [];
      let title = agent.title;
      const relayedTo = note('', 'ok');
      relayedTo.classList.add('small');
      const back = button('Back to Support', {
        small: true,
        onClick: () => {
          root.hidden = true;
          const support = tabs.find(({ kind }) => kind === 'support');
          if (support) shell.navigate(AGENT_SCREEN, { agentId: support.id });
          else shell.navigate(SUPPORT_SCREEN);
        },
      });
      const card = el('div', 'card stack', [el('h4', '', ['Support tab']), relayedTo, el('p', 'small muted', [RELAYED_HINT]), el('div', 'row', [back])]);
      const root = el('div', 'support-agent relay-note', [card]);
      root.hidden = true;
      container.append(root);

      const show = () => {
        relayedTo.textContent = `Relayed to ${title}.`;
      };
      const stopTabs = shell.onAgentTabs((list) => {
        tabs = list;
        title = list.find(({ id }) => id === agent.id)?.title ?? title;
        show();
      });
      const stopMessages = grillo.on('agent-chat:message', (payload) => {
        const { id, message } = payload as { id?: unknown; message?: Partial<ChatMessage> | null };
        if (id !== agent.id || message?.type !== 'user' || typeof message.text !== 'string') return;
        if (readRelayMark(message.text) === undefined) return;
        show();
        root.hidden = false;
      });

      return {
        dispose() {
          stopTabs();
          stopMessages();
        },
      };
    },
  };
}
