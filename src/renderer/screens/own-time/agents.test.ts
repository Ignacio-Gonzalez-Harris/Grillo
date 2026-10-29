import { describe, expect, it } from 'vitest';
import { createClaudeChatDriver } from '../../../main/features/agent-chat/driver';
import { createChatEventHub } from '../../../main/features/agent-chat/event-hub';
import { FakeChatProcess } from '../../../main/features/agent-chat/fake-process';
import { registerChosenAgentChannels } from '../../../main/features/agents/channels';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { createGrilloApi } from '../../../preload/bridge';
import { sendDone, sendUseIt } from './agents';

/** The real agent channels over chat agents, with Claude Code played by fake chat processes. */
async function chatAgent() {
  const fake = createFakeIpc();
  const processes: FakeChatProcess[] = [];
  const hub = createChatEventHub();
  const tools = { findClaude: () => '/opt/made-up/bin/claude', shipSkills: async () => undefined, env: {} };
  const driver = createClaudeChatDriver({
    ...tools,
    spawnProcess: (file, args, options) => {
      const process = new FakeChatProcess(file, args, options);
      processes.push(process);
      return process;
    },
    events: hub.events,
  });
  registerChosenAgentChannels(createMainIpc(fake.main, () => [fake.window]), 'chat', {
    terminal: {
      ...tools,
      spawnPty: () => {
        throw new Error('A chat tab never starts a terminal');
      },
    },
    chat: { driver, observe: hub.observe },
  });
  const grillo = createGrilloApi(fake.renderer);
  const id = await grillo.invoke('agents:start', {
    kind: 'grilling',
    folder: '/projects/sample-1',
    firstMessage: '',
    title: 'Grilling · Sample ticket',
  });
  const sent = () =>
    processes[0].writtenEvents
      .filter((event) => (event as { type?: string }).type === 'user')
      .map((event) => (event as { message: { content: string } }).message.content);
  return { grillo, id, sent };
}

describe('own-time messages to a chat agent', () => {
  it('sends "use it" with the imported transcript as one chat message', async () => {
    const { grillo, id, sent } = await chatAgent();

    await sendUseIt(grillo, id, 'Sample line from a file.\r\nSample reply.\r\n\r\n');

    expect(sent()).toEqual(['Sample line from a file.\nSample reply.\nuse it']);
  });

  it('sends Done as one chat message, and lets a failure through for the screen to show', async () => {
    const { grillo, id, sent } = await chatAgent();

    await sendDone(grillo, id);

    expect(sent()).toEqual(['done']);
    await expect(sendDone(grillo, 'no-such-tab')).rejects.toThrow('No agent with id');
  });
});
