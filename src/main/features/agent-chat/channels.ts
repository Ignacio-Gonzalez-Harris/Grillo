import type { MainIpc } from '../../ipc/bridge';
import { createClaudeChatDriver, type ChatDriver, type ChatDriverDeps, type ChatDriverEvents } from './driver';
import { relay } from './relay';

/**
 * Builds the chat driver with its events sent to the renderer, and to `also` when given (the agent runtime, which
 * shows the driver's agents as tabs), and answers the renderer's agent chat channels.
 */
export function registerAgentChatChannels(
  ipc: MainIpc,
  deps: Omit<ChatDriverDeps, 'events'>,
  also?: ChatDriverEvents,
): ChatDriver {
  const driver = createClaudeChatDriver({
    ...deps,
    events: {
      message: (id, message) => {
        ipc.send('agent-chat:message', { id, message });
        also?.message(id, message);
      },
      raw: (id, line) => {
        ipc.send('agent-chat:raw', { id, line });
        also?.raw(id, line);
      },
      exited: (id, exitCode) => {
        ipc.send('agent-chat:exited', { id, exitCode });
        also?.exited(id, exitCode);
      },
    },
  });

  ipc.handle('agent-chat:start', (request) => driver.startChatAgent(request));
  ipc.handle('agent-chat:send', ({ id, text }) => driver.send(id, text));
  ipc.handle('agent-chat:answer', ({ id, option }) => driver.answer(id, option));
  ipc.handle('agent-chat:allow', ({ id }) => driver.allow(id));
  ipc.handle('agent-chat:deny', ({ id }) => driver.deny(id));
  ipc.handle('agent-chat:relay', ({ targetAgentId, member, text }) => relay(driver, targetAgentId, member, text));
  ipc.handle('agent-chat:stop', ({ id }) => driver.stop(id));
  return driver;
}
