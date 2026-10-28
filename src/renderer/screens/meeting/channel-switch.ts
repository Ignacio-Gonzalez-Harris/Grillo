/**
 * The "Open channel" switch inside every agent's tab, beside its name and waiting dot (prototype `screen-meeting`):
 * while it is on, the live session writes each transcribed slice into that agent's input box (PRD 4.5 item 5).
 */
import { createSessionClient } from '../../../shared/session-ipc';
import { toggle } from '../../theme/components';
import type { TabPanel } from '../agent-tab/tab-panels';
import { messageOf } from '../map/view';

export const CHANNEL_LABEL = 'Channel';
export const CHANNEL_NAME = 'Open channel';
const CHANNEL_HINT = 'While on, this agent receives the live session transcript in its type box.';

export function channelSwitchPanel(): TabPanel {
  return {
    kinds: 'all',
    slot: 'header',
    priority: 0,
    mount(container, { agent, grillo }) {
      const session = createSessionClient(grillo);
      let disposed = false;
      const { root, input } = toggle(CHANNEL_LABEL, { onChange: (open) => void setChannel(open) });
      input.setAttribute('aria-label', CHANNEL_NAME);
      root.title = CHANNEL_HINT;
      container.append(root);

      /** Reads the open channels from the host itself: a channel may be open before any session runs. */
      function show(): void {
        session.channels().then(
          (open) => {
            if (!disposed) input.checked = open.includes(agent.id);
          },
          () => undefined,
        );
      }

      async function setChannel(open: boolean): Promise<void> {
        input.disabled = true;
        try {
          await session.setChannel(agent.id, open);
          root.title = CHANNEL_HINT;
        } catch (error) {
          input.checked = !open;
          root.title = `The channel could not be ${open ? 'opened' : 'closed'}: ${messageOf(error)}`;
        } finally {
          input.disabled = false;
        }
      }

      const stop = grillo.on('session:changed', show);
      show();

      return {
        dispose() {
          disposed = true;
          stop();
        },
      };
    },
  };
}
