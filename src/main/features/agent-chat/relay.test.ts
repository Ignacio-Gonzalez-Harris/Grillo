import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../shared/agent-chat';
import { createClaudeChatDriver } from './driver';
import { FakeChatProcess } from './fake-process';
import { recorded } from './recorded-events';
import { relay } from './relay';

async function twoAgents() {
  const processes: FakeChatProcess[] = [];
  const messages: Array<{ id: string; message: ChatMessage }> = [];
  const driver = createClaudeChatDriver({
    findClaude: () => '/opt/made-up/bin/claude',
    shipSkills: async () => undefined,
    spawnProcess: (file, args, options) => {
      const process = new FakeChatProcess(file, args, options);
      processes.push(process);
      return process;
    },
    env: {},
    events: { message: (id, message) => messages.push({ id, message }), raw: () => undefined, exited: () => undefined },
  });
  const support = await driver.startChatAgent({ kind: 'support', folder: '/home/made-up/p', firstMessage: '' });
  const target = await driver.startChatAgent({ kind: 'grilling', folder: '/home/made-up/p', firstMessage: '' });
  processes.forEach((process) => (process.written.length = 0));
  return { driver, support, target, supportProcess: processes[0], targetProcess: processes[1], messages };
}

describe('relay into another agent’s chat', () => {
  it('writes one prefixed user line into the target agent, whose reply arrives in its own stream', async () => {
    const { driver, support, target, supportProcess, targetProcess, messages } = await twoAgents();

    const result = relay(driver, target, 'Ada', 'Please re-check the Login flow answer.');
    targetProcess.emit(recorded.assistantText('Relay received.'), recorded.result('Relay received.'));

    expect(result).toEqual({ ok: true });
    expect(targetProcess.written).toEqual([
      `${JSON.stringify({ type: 'user', message: { role: 'user', content: '[from Support, for Ada] Please re-check the Login flow answer.' } })}\n`,
    ]);
    expect(supportProcess.written).toEqual([]);
    expect(messages.filter((m) => m.id === target).map((m) => m.message)).toEqual([
      { type: 'user', text: '[from Support, for Ada] Please re-check the Login flow answer.' },
      { type: 'assistant', text: 'Relay received.' },
      { type: 'result', isError: false, text: 'Relay received.' },
    ]);
    expect(messages.some((m) => m.id === support)).toBe(false);
  });

  const names: Array<[string, string, string]> = [
    ['brackets', 'Ada [Lead] ]x[', '[from Support, for Ada (Lead) )x(]'],
    ['a colon', 'Ada: Lovelace', '[from Support, for Ada: Lovelace]'],
    ['line breaks', 'Ada\r\nLovelace\nThe second', '[from Support, for Ada Lovelace The second]'],
    ['tabs and padding', '  Ada\t Lovelace  ', '[from Support, for Ada Lovelace]'],
  ];

  it.each(names)('keeps the prefix one closed bracket on one line for a member name with %s', async (_n, member, prefix) => {
    const { driver, target, targetProcess } = await twoAgents();

    relay(driver, target, member, 'First line\nsecond line');

    expect(targetProcess.written).toHaveLength(1);
    const [line] = targetProcess.written;
    expect(line.indexOf('\n')).toBe(line.length - 1);
    expect(targetProcess.writtenEvents).toEqual([
      { type: 'user', message: { role: 'user', content: `${prefix} First line\nsecond line` } },
    ]);
  });

  it('refuses an empty member, empty text and an unknown target without writing anything', async () => {
    const { driver, target, targetProcess } = await twoAgents();

    const results = [
      relay(driver, target, '', 'hello'),
      relay(driver, target, ' \n\t', 'hello'),
      relay(driver, target, 'Ada', ''),
      relay(driver, target, 'Ada', '   '),
      relay(driver, target, null as never, 'hello'),
      relay(driver, 'no-such-agent', 'Ada', 'hello'),
    ];

    expect(results.every((result) => !result.ok && typeof result.reason === 'string')).toBe(true);
    expect(targetProcess.written).toEqual([]);
  });
});
