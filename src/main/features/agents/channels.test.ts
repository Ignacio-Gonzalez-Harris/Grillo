import { describe, expect, it, vi } from 'vitest';
import { createGrilloApi } from '../../../preload/bridge';
import type { AgentInfo, StartAgentRequest } from '../../../shared/agents';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import type { AgentRuntimeChoice } from '../../../shared/agents';
import { createClaudeChatDriver } from '../agent-chat/driver';
import { createChatEventHub } from '../agent-chat/event-hub';
import { FakeChatProcess } from '../agent-chat/fake-process';
import { registerAgentChannels, registerChosenAgentChannels } from './channels';
import { FakePty } from './fake-pty';
import { agentRuntimeChoice } from './runtime-choice';

const request: StartAgentRequest = {
  kind: 'task',
  folder: '/home/ada/demo-project',
  firstMessage: '',
  title: 'Task · Export button',
};

function connect() {
  const fake = createFakeIpc();
  const ptys: FakePty[] = [];
  registerAgentChannels(createMainIpc(fake.main, () => [fake.window]), {
    findClaude: () => '/opt/made-up/bin/claude',
    shipSkills: async () => undefined,
    spawnPty: (file, args, options) => {
      const pty = new FakePty(file, args, options);
      ptys.push(pty);
      return pty;
    },
    env: {},
  });
  return { grillo: createGrilloApi(fake.renderer), ptys };
}

describe('agent IPC channels', () => {
  it('starts an agent from the renderer and streams its output and list changes back', async () => {
    const { grillo, ptys } = connect();
    const output: Array<{ id: string; data: string }> = [];
    const lists: AgentInfo[][] = [];
    grillo.on('agents:output', (event) => output.push(event));
    grillo.on('agents:list-changed', (list) => lists.push(list));

    const id = await grillo.invoke('agents:start', request);
    ptys[0].print('claude says hi');

    expect(output).toEqual([{ id, data: 'claude says hi' }]);
    expect(lists.at(-1)).toEqual([{ id, kind: 'task', title: request.title, folder: request.folder, waiting: false }]);
    await expect(grillo.invoke('agents:list', undefined)).resolves.toEqual(lists.at(-1));
  });

  it('types, resizes, renames and stops an agent from the renderer', async () => {
    const { grillo, ptys } = connect();
    const id = await grillo.invoke('agents:start', request);

    await grillo.invoke('agents:write', { id, text: 'hello\r' });
    await grillo.invoke('agents:resize', { id, cols: 90, rows: 20 });
    await grillo.invoke('agents:set-title', { id, title: 'Task · Import button' });
    const renamed = await grillo.invoke('agents:list', undefined);
    await grillo.invoke('agents:stop', { id });

    expect(ptys[0].written).toEqual(['hello\r']);
    expect(ptys[0].sizes).toEqual([[90, 20]]);
    expect(renamed[0].title).toBe('Task · Import button');
    expect(ptys[0].killed).toBe(true);
    await expect(grillo.invoke('agents:list', undefined)).resolves.toEqual([]);
  });

  it('tells the renderer when an agent ends on its own', async () => {
    const { grillo, ptys } = connect();
    const exits: Array<{ id: string; exitCode: number }> = [];
    grillo.on('agents:exited', (event) => exits.push(event));
    const id = await grillo.invoke('agents:start', request);

    ptys[0].exit(2);

    expect(exits).toEqual([{ id, exitCode: 2 }]);
  });
});

/** The channels over the chosen runtime, with both kinds of Claude Code faked, so a hidden second one would show. */
function connectChosen(choice: AgentRuntimeChoice) {
  const fake = createFakeIpc();
  const ptys: FakePty[] = [];
  const chats: FakeChatProcess[] = [];
  const hub = createChatEventHub();
  const tools = { findClaude: () => '/opt/made-up/bin/claude', shipSkills: async () => undefined, env: {} };
  const driver = createClaudeChatDriver({
    ...tools,
    spawnProcess: (file, args, options) => {
      const process = new FakeChatProcess(file, args, options);
      chats.push(process);
      return process;
    },
    events: hub.events,
  });
  const runtime = registerChosenAgentChannels(createMainIpc(fake.main, () => [fake.window]), choice, {
    terminal: {
      ...tools,
      spawnPty: (file, args, options) => {
        const pty = new FakePty(file, args, options);
        ptys.push(pty);
        return pty;
      },
    },
    chat: { driver, observe: hub.observe },
  });
  return { grillo: createGrilloApi(fake.renderer), ptys, chats, runtime };
}

describe('agent IPC channels with GRILLO_AGENT_RUNTIME unset', () => {
  function connectDefault() {
    const warn = vi.fn();
    return { ...connectChosen(agentRuntimeChoice({}, warn)), warn };
  }

  it('runs a new agent tab as Claude Code in a terminal, and its type box reaches the agent', async () => {
    const { grillo, ptys, chats, warn } = connectDefault();

    const id = await grillo.invoke('agents:start', request);
    await grillo.invoke('agents:write', { id, text: 'Sample answer\r' });

    expect(ptys).toHaveLength(1);
    expect(chats).toEqual([]);
    expect(ptys[0].written).toEqual(['Sample answer\r']);
    expect(warn).not.toHaveBeenCalled();
  });

  it("takes the live session's transcript slices into the agent's input box as they are spoken", async () => {
    const { grillo, ptys, runtime } = connectDefault();
    const id = await grillo.invoke('agents:start', request);

    runtime.write(id, 'Ada: first sample line');
    runtime.write(id, '\nBen: second sample line');

    expect(runtime.choice).toBe('terminal');
    expect(ptys[0].written).toEqual(['Ada: first sample line', '\nBen: second sample line']);
  });
});

describe('agent IPC channels over the chosen runtime', () => {
  it('runs exactly one chat Claude Code per tab under chat, and no terminal beside it', async () => {
    const { grillo, ptys, chats } = connectChosen('chat');

    const ids = [await grillo.invoke('agents:start', request), await grillo.invoke('agents:start', request)];

    expect(chats).toHaveLength(2);
    expect(ptys).toEqual([]);
    await expect(grillo.invoke('agents:list', undefined)).resolves.toEqual(
      ids.map((id) => ({ id, kind: 'task', title: request.title, folder: request.folder, waiting: false })),
    );
  });

  it('runs exactly one terminal Claude Code per tab under terminal, and no chat process beside it', async () => {
    const { grillo, ptys, chats } = connectChosen('terminal');

    await grillo.invoke('agents:start', request);
    await grillo.invoke('agents:start', request);

    expect(ptys).toHaveLength(2);
    expect(chats).toEqual([]);
  });

  it('sends one whole message from the renderer as one chat message, and rejects one for an unknown tab', async () => {
    const { grillo, chats } = connectChosen('chat');
    const id = await grillo.invoke('agents:start', request);

    await grillo.invoke('agents:send', { id, text: 'Sample message' });

    expect(chats[0].writtenEvents.filter((event) => (event as { type?: string }).type === 'user')).toEqual([
      { type: 'user', message: { role: 'user', content: 'Sample message' } },
    ]);
    await expect(grillo.invoke('agents:send', { id: 'no-such-tab', text: 'x' })).rejects.toThrow('No agent with id');
  });
});
