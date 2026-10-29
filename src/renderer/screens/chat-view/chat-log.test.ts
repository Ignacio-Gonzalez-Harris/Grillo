import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../shared/agent-chat';
import type { EventChannel, EventPayload, GrilloApi } from '../../../shared/ipc';
import { createChatLog, MAX_RAW_LINES, UNREADABLE_MESSAGE } from './chat-log';

/** A renderer API whose events the test sends by hand, in any shape, as a broken or hostile main process could. */
function fakeGrillo() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const grillo: GrilloApi = {
    invoke: () => Promise.reject(new Error('Not used here')),
    on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void) {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener as (payload: unknown) => void);
      listeners.set(channel, set);
      return () => set.delete(listener as (payload: unknown) => void);
    },
  };
  const send = (channel: string, payload: unknown) => listeners.get(channel)?.forEach((listener) => listener(payload));
  return { grillo, send, listeners };
}

/** Everything one agent's log hands its view, in order. */
function follow(log: ReturnType<typeof createChatLog>, agentId: string) {
  const messages: ChatMessage[] = [];
  const raw: string[] = [];
  const stop = log.follow(agentId, { message: (message) => messages.push(message), raw: (line) => raw.push(line) });
  return { messages, raw, stop };
}

const QUESTION = {
  type: 'question',
  id: 'q-1',
  questions: [
    {
      question: 'Which sample colour?',
      header: 'Colour',
      options: [{ label: 'Sample red', description: 'A made-up option.' }],
      multiSelect: false,
    },
  ],
};

describe('chat log: every chat agent message from the moment Grillo starts, for the chat view', () => {
  it('keeps what an agent said before its tab appeared, then hands over the rest live, per agent', () => {
    const { grillo, send } = fakeGrillo();
    const log = createChatLog(grillo);
    send('agent-chat:message', { id: 'a-1', message: { type: 'user', text: 'Sample first message' } });
    send('agent-chat:raw', { id: 'a-1', line: '{"type":"system"}' });
    send('agent-chat:message', { id: 'a-2', message: { type: 'user', text: 'Another agent' } });

    const view = follow(log, 'a-1');
    send('agent-chat:message', { id: 'a-1', message: { type: 'assistant', text: 'Sample reply' } });

    expect(view.messages).toEqual([
      { type: 'user', text: 'Sample first message' },
      { type: 'assistant', text: 'Sample reply' },
    ]);
    expect(view.raw).toEqual(['{"type":"system"}']);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'assistant'],
    ['an unknown type', { type: 'telemetry', text: 'Sample' }],
    ['no type', { text: 'Sample' }],
    ['assistant text that is not text', { type: 'assistant', text: 42 }],
    ['a question with no options list', { ...QUESTION, questions: [{ ...QUESTION.questions[0], options: null }] }],
    ['a question with no questions', { ...QUESTION, questions: [] }],
    ['a question with an option without a label', { ...QUESTION, questions: [{ ...QUESTION.questions[0], options: [{}] }] }],
    ['a permission with no id', { type: 'permission', toolName: 'Bash', input: {}, description: '' }],
    ['a permission whose input is null', { type: 'permission', id: 'p-1', toolName: 'Bash', input: null, description: '' }],
    ['a result with no error flag', { type: 'result', text: 'Done' }],
  ])('turns %s into the one error the view shows, and carries on', (_case, message) => {
    const { grillo, send } = fakeGrillo();
    const log = createChatLog(grillo);
    const view = follow(log, 'a-1');

    send('agent-chat:message', { id: 'a-1', message });
    send('agent-chat:message', { id: 'a-1', message: { type: 'assistant', text: 'Still here' } });

    expect(view.messages).toEqual([
      { type: 'error', message: expect.stringContaining(UNREADABLE_MESSAGE) },
      { type: 'assistant', text: 'Still here' },
    ]);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['no agent id', { message: { type: 'assistant', text: 'Sample' } }],
    ['an empty agent id', { id: '', message: { type: 'assistant', text: 'Sample' } }],
  ])('drops an event with %s, which belongs to no tab, and says so in the console', (_case, payload) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { grillo, send } = fakeGrillo();
    const log = createChatLog(grillo);
    const view = follow(log, 'a-1');

    send('agent-chat:message', payload);
    send('agent-chat:raw', payload);

    expect(view.messages).toEqual([]);
    expect(view.raw).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('shows a question or permission Claude Code repeats only once, so it is never answered twice', () => {
    const { grillo, send } = fakeGrillo();
    const log = createChatLog(grillo);
    const permission = { type: 'permission', id: 'p-1', toolName: 'Bash', input: { command: 'ls' }, description: '' };

    for (const message of [QUESTION, QUESTION, permission, permission]) send('agent-chat:message', { id: 'a-1', message });

    expect(follow(log, 'a-1').messages.map((message) => message.type)).toEqual(['question', 'permission']);
  });

  it('skips a raw line that is not text, and keeps only the newest raw lines of a long run', () => {
    const { grillo, send } = fakeGrillo();
    const log = createChatLog(grillo);
    send('agent-chat:raw', { id: 'a-1', line: null });
    for (let line = 0; line <= MAX_RAW_LINES; line += 1) send('agent-chat:raw', { id: 'a-1', line: `line ${line}` });

    const { raw } = follow(log, 'a-1');

    expect(raw).toHaveLength(MAX_RAW_LINES);
    expect(raw[0]).toBe('line 1');
  });

  it('forgets an agent once it has ended, and stops listening when disposed', () => {
    const { grillo, send, listeners } = fakeGrillo();
    const log = createChatLog(grillo);
    send('agent-chat:message', { id: 'a-1', message: { type: 'assistant', text: 'Sample' } });

    send('agent-chat:exited', { id: 'a-1', exitCode: 0 });
    const afterExit = follow(log, 'a-1').messages;
    log.dispose();

    expect(afterExit).toEqual([]);
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });

  it('stops handing an agent its messages once its view stops following', () => {
    const { grillo, send } = fakeGrillo();
    const view = follow(createChatLog(grillo), 'a-1');

    view.stop();
    send('agent-chat:message', { id: 'a-1', message: { type: 'assistant', text: 'Sample' } });

    expect(view.messages).toEqual([]);
  });
});
