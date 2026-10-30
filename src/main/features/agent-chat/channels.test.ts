import { describe, expect, it } from 'vitest';
import { createGrilloApi } from '../../../preload/bridge';
import type { ChatMessage } from '../../../shared/agent-chat';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import { registerAgentChatChannels } from './channels';
import type { ChatDriverEvents } from './driver';
import { FakeChatProcess } from './fake-process';
import { PERMISSION_REQUEST_ID, QUESTION_REQUEST_ID, recorded } from './recorded-events';

function connect(also?: ChatDriverEvents) {
  const fake = createFakeIpc();
  const processes: FakeChatProcess[] = [];
  registerAgentChatChannels(
    createMainIpc(fake.main, () => [fake.window]),
    {
      findClaude: () => '/opt/made-up/bin/claude',
      shipSkills: async () => undefined,
      spawnProcess: (file, args, options) => {
        const process = new FakeChatProcess(file, args, options);
        processes.push(process);
        return process;
      },
      env: {},
    },
    also,
  );
  const grillo = createGrilloApi(fake.renderer);
  const messages: Array<{ id: string; message: ChatMessage }> = [];
  const raw: Array<{ id: string; line: string }> = [];
  const exits: Array<{ id: string; exitCode: number | null }> = [];
  grillo.on('agent-chat:message', (event) => messages.push(event));
  grillo.on('agent-chat:raw', (event) => raw.push(event));
  grillo.on('agent-chat:exited', (event) => exits.push(event));
  return { grillo, processes, messages, raw, exits };
}

const start = { kind: 'grilling', folder: '/home/made-up/demo-project', firstMessage: 'Hello' } as const;

describe('agent chat IPC channels', () => {
  it('starts a chat agent from the renderer and streams its typed messages, raw lines and exit back', async () => {
    const { grillo, processes, messages, raw, exits } = connect();

    const id = await grillo.invoke('agent-chat:start', start);
    processes[0].emit(recorded.assistantText('Hi there'), recorded.questionRequest);
    processes[0].exit(0);

    expect(messages).toEqual([
      { id, message: { type: 'user', text: 'Hello' } },
      { id, message: { type: 'assistant', text: 'Hi there' } },
      { id, message: expect.objectContaining({ type: 'question', id: QUESTION_REQUEST_ID }) },
    ]);
    expect(raw).toEqual([
      { id, line: recorded.assistantText('Hi there') },
      { id, line: recorded.questionRequest },
    ]);
    expect(exits).toEqual([{ id, exitCode: 0 }]);
  });

  it('answers, allows, denies, sends, relays and stops from the renderer', async () => {
    const { grillo, processes } = connect();
    const id = await grillo.invoke('agent-chat:start', start);
    const target = await grillo.invoke('agent-chat:start', { ...start, firstMessage: '' });
    processes[0].emit(recorded.questionRequest, recorded.permissionRequest);
    processes[0].written.length = 0;
    processes[1].written.length = 0;

    const results = [
      await grillo.invoke('agent-chat:answer', { id: QUESTION_REQUEST_ID, option: 'Blue' }),
      await grillo.invoke('agent-chat:allow', { id: PERMISSION_REQUEST_ID }),
      await grillo.invoke('agent-chat:send', { id, text: 'Thanks' }),
      await grillo.invoke('agent-chat:relay', { targetAgentId: target, member: 'Ada', text: 'Check this' }),
    ];
    const deniedTwice = await grillo.invoke('agent-chat:deny', { id: PERMISSION_REQUEST_ID });
    await grillo.invoke('agent-chat:stop', { id });

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
    expect(deniedTwice.ok).toBe(false);
    expect(processes[0].writtenEvents.map((e) => (e as { type: string }).type)).toEqual([
      'control_response',
      'control_response',
      'user',
    ]);
    expect(processes[1].writtenEvents).toEqual([
      { type: 'user', message: { role: 'user', content: '[from Support, for Ada] Check this' } },
    ]);
    expect(processes[0].stopped).toBe(true);
  });

  it('reports a stop through agent-chat:stop as an end with no exit code, once, to every listener', async () => {
    const seen: string[] = [];
    const { grillo, processes, exits } = connect({
      message: () => undefined,
      raw: () => undefined,
      exited: (id, exitCode) => seen.push(`${id} exited ${exitCode}`),
    });
    const id = await grillo.invoke('agent-chat:start', start);

    await grillo.invoke('agent-chat:stop', { id });
    await grillo.invoke('agent-chat:stop', { id });
    await grillo.invoke('agent-chat:stop', { id: 'no-such-agent' });
    processes[0].exit(0);

    expect(processes[0].stopped).toBe(true);
    expect(exits).toEqual([{ id, exitCode: null }]);
    expect(seen).toEqual([`${id} exited null`]);
  });

  it('hands every driver event to another listener too, such as the agent runtime', async () => {
    const seen: string[] = [];
    const { grillo, processes } = connect({
      message: (id, message) => seen.push(`${id} message ${message.type}`),
      raw: (id) => seen.push(`${id} raw`),
      exited: (id, exitCode) => seen.push(`${id} exited ${exitCode}`),
    });

    const id = await grillo.invoke('agent-chat:start', start);
    processes[0].emit(recorded.assistantText('Hi there'));
    processes[0].exit(0);

    expect(seen).toEqual([`${id} message user`, `${id} raw`, `${id} message assistant`, `${id} exited 0`]);
  });
});
