import { describe, expect, it } from 'vitest';
import type { ChatMessage, StartChatAgentRequest } from '../../../shared/agent-chat';
import { AGENT_ID_VARIABLE } from '../../../shared/agents';
import { ClaudeNotFoundError } from '../agents/runtime';
import { CHAT_FLAGS, createClaudeChatDriver, type ChatDriverDeps } from './driver';
import { FakeChatProcess } from './fake-process';
import {
  PERMISSION_REQUEST_ID,
  QUESTION_INPUT,
  QUESTION_REQUEST_ID,
  recorded,
  WRITE_INPUT,
} from './recorded-events';

const CLAUDE_PATH = '/opt/made-up/bin/claude';

const request: StartChatAgentRequest = {
  kind: 'grilling',
  folder: '/home/made-up/demo-project',
  firstMessage: 'Start grilling the Login flow ticket',
};

function setup(overrides: Partial<ChatDriverDeps> = {}) {
  const processes: FakeChatProcess[] = [];
  const steps: string[] = [];
  const messages: Array<{ id: string; message: ChatMessage }> = [];
  const raw: Array<{ id: string; line: string }> = [];
  const exits: Array<{ id: string; exitCode: number | null }> = [];
  const driver = createClaudeChatDriver({
    findClaude: () => CLAUDE_PATH,
    shipSkills: async (folder) => {
      steps.push(`ship ${folder}`);
    },
    spawnProcess: (file, args, options) => {
      steps.push('spawn');
      const process = new FakeChatProcess(file, args, options);
      processes.push(process);
      return process;
    },
    env: { PATH: '/opt/made-up/bin' },
    events: {
      message: (id, message) => messages.push({ id, message }),
      raw: (id, line) => raw.push({ id, line }),
      exited: (id, exitCode) => exits.push({ id, exitCode }),
    },
    ...overrides,
  });
  const only = (id: string): ChatMessage[] => messages.filter((m) => m.id === id).map((m) => m.message);
  return { driver, processes, steps, messages, raw, exits, only };
}

/** A started agent whose stdin writes so far (initialize, first message) are cleared. */
async function started(overrides: Partial<ChatDriverDeps> = {}) {
  const context = setup(overrides);
  const id = await context.driver.startChatAgent(request);
  const process = context.processes[0];
  const initializeId = (process.writtenEvents[0] as { request_id: string }).request_id;
  process.written.length = 0;
  return { ...context, id, process, initializeId };
}

function controlResponse(requestId: string, response: unknown) {
  return { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } };
}

describe('chat driver: starting', () => {
  it('starts claude in machine-readable mode with the pinned flags, never --bare, after shipping the skills', async () => {
    const { driver, processes, steps } = setup();

    const id = await driver.startChatAgent(request);

    expect(steps).toEqual([`ship ${request.folder}`, 'spawn']);
    expect(processes[0].file).toBe(CLAUDE_PATH);
    expect(processes[0].args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-prompt-tool',
      'stdio',
      '--permission-mode',
      'manual',
    ]);
    expect(CHAT_FLAGS).not.toContain('--bare');
    // The agent's skills read its id to say which tab holds what (grillo-meeting, "Holding a ticket in this session").
    expect(processes[0].options).toEqual({ cwd: request.folder, env: { PATH: '/opt/made-up/bin', [AGENT_ID_VARIABLE]: id } });
  });

  it('opens the control channel, then sends the first message as one user line and echoes it', async () => {
    const { driver, processes, only } = setup();

    const id = await driver.startChatAgent(request);

    const [initialize, first] = processes[0].writtenEvents as Array<Record<string, unknown>>;
    expect(initialize).toMatchObject({ type: 'control_request', request: { subtype: 'initialize' } });
    expect(first).toEqual({ type: 'user', message: { role: 'user', content: request.firstMessage } });
    expect(processes[0].written.every((data) => data.endsWith('\n') && data.indexOf('\n') === data.length - 1)).toBe(
      true,
    );
    expect(only(id)).toEqual([{ type: 'user', text: request.firstMessage }]);
  });

  it('sends nothing but the control channel opening when the first message is empty', async () => {
    const { driver, processes } = setup();

    await driver.startChatAgent({ ...request, firstMessage: '' });

    expect(processes[0].writtenEvents).toHaveLength(1);
  });

  it('refuses an invalid request and a missing claude without starting anything', async () => {
    const invalid = setup();
    await expect(invalid.driver.startChatAgent({ ...request, kind: 'boss' as never })).rejects.toThrow(/Invalid/);
    await expect(invalid.driver.startChatAgent({ ...request, folder: '' })).rejects.toThrow(/Invalid/);
    expect(invalid.processes).toHaveLength(0);

    const missing = setup({
      findClaude: () => {
        throw new ClaudeNotFoundError();
      },
    });
    await expect(missing.driver.startChatAgent(request)).rejects.toThrow(ClaudeNotFoundError);
    expect(missing.processes).toHaveLength(0);
  });
});

describe('chat driver: the event stream', () => {
  it('turns a recorded run into typed messages and keeps every raw line', async () => {
    const { id, process, only, raw, initializeId } = await started();
    const lines = [
      recorded.initializeResponse(initializeId),
      recorded.init,
      recorded.assistantToolUse,
      recorded.rateLimit,
      recorded.toolResult,
      recorded.thinkingTokens,
      recorded.assistantText('Done: you picked Blue.'),
      recorded.result('Done: you picked Blue.'),
    ];

    process.emit(...lines);

    expect(only(id).slice(1)).toEqual([
      {
        type: 'init',
        sessionId: '00000000-0000-4000-8000-000000000001',
        model: 'claude-made-up-model',
        tools: ['Task', 'AskUserQuestion', 'Bash', 'Read', 'Write'],
      },
      { type: 'assistant', text: 'Done: you picked Blue.' },
      { type: 'result', isError: false, text: 'Done: you picked Blue.' },
    ]);
    expect(raw.map((r) => r.line)).toEqual(lines);
  });

  it('reads lines split across chunks, Windows line ends and blank lines, and a last line with no line end', async () => {
    const { id, process, only } = await started();
    const text = recorded.assistantText('Héllo wörld 🟢');

    process.print(text.slice(0, 10));
    process.print(`${text.slice(10, 40)}`);
    process.print(`${text.slice(40)}\r\n\r\n\n`);
    process.print(recorded.result('ok'));
    process.exit(0);

    expect(only(id).slice(1)).toEqual([
      { type: 'assistant', text: 'Héllo wörld 🟢' },
      { type: 'result', isError: false, text: 'ok' },
    ]);
  });

  it('joins several text blocks into one bubble and leaves out sub-agents and turns with no text', async () => {
    const { id, process, only } = await started();

    process.emit(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'One.' }, { type: 'thinking', thinking: '' }, { type: 'text', text: 'Two.' }] },
        parent_tool_use_id: null,
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'From a sub-agent' }] },
        parent_tool_use_id: 'toolu_made_up_9',
      }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } }),
    );

    expect(only(id).slice(1)).toEqual([{ type: 'assistant', text: 'One.\nTwo.' }]);
  });

  it('marks a failed turn as an error result even when it has no result text', async () => {
    const { id, process, only } = await started();

    process.emit(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['x'] }));

    expect(only(id).at(-1)).toEqual({ type: 'result', isError: true, text: '' });
  });

  it('ignores event types it does not know, for forward compatibility', async () => {
    const { id, process, only, raw } = await started();

    process.emit(JSON.stringify({ type: 'some_future_event', value: 1 }), JSON.stringify({ type: 'keep_alive' }));

    expect(only(id)).toHaveLength(1);
    expect(raw).toHaveLength(2);
  });

  const malformed: Array<[string, string]> = [
    ['a line that is not JSON', '{"type":"assistant",'],
    ['JSON null', 'null'],
    ['a JSON list', '[1,2]'],
    ['a JSON number', '42'],
    ['an object with no type', '{"subtype":"init"}'],
    ['a non-string type', '{"type":7}'],
    ['an assistant event with no message', '{"type":"assistant"}'],
    ['an assistant event whose content is null', '{"type":"assistant","message":{"content":null}}'],
    ['an assistant event with a null content element', '{"type":"assistant","message":{"content":[null]}}'],
    ['a text block whose text is null', '{"type":"assistant","message":{"content":[{"type":"text","text":null}]}}'],
    ['an init event with a null tool', '{"type":"system","subtype":"init","session_id":"s","model":"m","tools":["Read",null]}'],
    ['an init event with no session id', '{"type":"system","subtype":"init","model":"m","tools":[]}'],
    ['a result event with no subtype', '{"type":"result","result":"x"}'],
    ['a result event whose text is not a string', '{"type":"result","subtype":"success","is_error":false,"result":5}'],
    ['a control request with no id', '{"type":"control_request","request":{"subtype":"can_use_tool"}}'],
    ['a control request with a null id', '{"type":"control_request","request_id":null,"request":null}'],
    ['a control response with no response', '{"type":"control_response"}'],
    ['a control response for an id never asked', '{"type":"control_response","response":{"subtype":"success","request_id":"nobody"}}'],
  ];

  it.each(malformed)('turns %s into one error message and carries on', async (_name, line) => {
    const { id, process, only } = await started();

    expect(() => process.emit(line, recorded.assistantText('still here'))).not.toThrow();

    const messages = only(id).slice(1);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ type: 'error', message: expect.any(String) });
    expect(messages[1]).toEqual({ type: 'assistant', text: 'still here' });
  });

  it('reports a failed control channel opening as an error', async () => {
    const { id, process, only, initializeId } = await started();

    process.emit(
      JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: initializeId, error: 'nope' } }),
    );

    expect(only(id).at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('nope') });
  });
});

describe('chat driver: questions and permissions', () => {
  it('turns an AskUserQuestion control request into a question and answers it once with the chosen option', async () => {
    const { id, driver, process, only } = await started();

    process.emit(recorded.questionRequest);
    const result = driver.answer(QUESTION_REQUEST_ID, 'Blue');
    const again = driver.answer(QUESTION_REQUEST_ID, 'Red');

    expect(only(id).at(-1)).toEqual({ type: 'question', id: QUESTION_REQUEST_ID, questions: QUESTION_INPUT.questions });
    expect(result).toEqual({ ok: true });
    expect(process.writtenEvents).toEqual([
      controlResponse(QUESTION_REQUEST_ID, {
        behavior: 'allow',
        updatedInput: { ...QUESTION_INPUT, answers: { 'Which colour?': 'Blue' } },
      }),
    ]);
    expect(again).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('turns any other tool request into a permission that allow or deny answers once', async () => {
    const { id, driver, process, only } = await started();

    process.emit(recorded.permissionRequest);
    const allowed = driver.allow(PERMISSION_REQUEST_ID);
    const deniedAfter = driver.deny(PERMISSION_REQUEST_ID);

    expect(only(id).at(-1)).toEqual({
      type: 'permission',
      id: PERMISSION_REQUEST_ID,
      toolName: 'Write',
      input: WRITE_INPUT,
      description: 'colour.txt',
    });
    expect(allowed).toEqual({ ok: true });
    expect(deniedAfter.ok).toBe(false);
    expect(process.writtenEvents).toEqual([
      controlResponse(PERMISSION_REQUEST_ID, { behavior: 'allow', updatedInput: WRITE_INPUT }),
    ]);
  });

  it('denies a permission, and deny also dismisses a question', async () => {
    const { driver, process } = await started();

    process.emit(recorded.permissionRequest, recorded.questionRequest);

    expect(driver.deny(PERMISSION_REQUEST_ID)).toEqual({ ok: true });
    expect(driver.deny(QUESTION_REQUEST_ID)).toEqual({ ok: true });
    expect(process.writtenEvents).toEqual([
      controlResponse(PERMISSION_REQUEST_ID, { behavior: 'deny', message: expect.any(String) }),
      controlResponse(QUESTION_REQUEST_ID, { behavior: 'deny', message: expect.any(String) }),
    ]);
  });

  it('refuses the wrong answer kind, an unknown id and a bad answer without writing anything', async () => {
    const { driver, process } = await started();
    process.emit(recorded.permissionRequest, recorded.questionRequest);

    const refused = [
      driver.answer(PERMISSION_REQUEST_ID, 'Blue'),
      driver.allow(QUESTION_REQUEST_ID),
      driver.answer('no-such-id', 'Blue'),
      driver.allow('no-such-id'),
      driver.deny('no-such-id'),
      driver.answer(QUESTION_REQUEST_ID, ''),
      driver.answer(QUESTION_REQUEST_ID, { 'Another question?': 'Blue' }),
      driver.answer(QUESTION_REQUEST_ID, null as never),
    ];

    expect(refused.every((result) => !result.ok && typeof result.reason === 'string')).toBe(true);
    expect(process.written).toEqual([]);
  });

  it('answers a several-question prompt only with an answer for each question', async () => {
    const { driver, process } = await started();
    const input = {
      questions: [
        { question: 'Which colour?', header: 'Colour', options: [{ label: 'Red', description: '' }], multiSelect: false },
        { question: 'Which size?', header: 'Size', options: [{ label: 'Big' }, { label: 'Small' }], multiSelect: true },
      ],
    };
    process.emit(
      JSON.stringify({ type: 'control_request', request_id: 'q-2', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input } }),
    );

    expect(driver.answer('q-2', 'Red').ok).toBe(false);
    expect(driver.answer('q-2', { 'Which colour?': 'Red' }).ok).toBe(false);
    expect(driver.answer('q-2', { 'Which colour?': 'Red', 'Which size?': 'Big, Small' })).toEqual({ ok: true });
    expect(process.writtenEvents).toEqual([
      controlResponse('q-2', {
        behavior: 'allow',
        updatedInput: { ...input, answers: { 'Which colour?': 'Red', 'Which size?': 'Big, Small' } },
      }),
    ]);
  });

  const unreadableQuestions: Array<[string, unknown]> = [
    ['no questions', {}],
    ['an empty question list', { questions: [] }],
    ['a null question', { questions: [null] }],
    ['a question with no text', { questions: [{ options: [{ label: 'A' }] }] }],
    ['a null option', { questions: [{ question: 'Q?', options: [null] }] }],
    ['an option with no label', { questions: [{ question: 'Q?', options: [{ description: 'd' }] }] }],
  ];

  it.each(unreadableQuestions)(
    'turns a question with %s into an error and answers Claude Code with an error so it does not hang',
    async (_name, input) => {
      const { id, driver, process, only } = await started();

      process.emit(
        JSON.stringify({ type: 'control_request', request_id: 'bad-q', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input } }),
      );

      expect(only(id).at(-1)).toMatchObject({ type: 'error' });
      expect(process.writtenEvents).toEqual([
        { type: 'control_response', response: { subtype: 'error', request_id: 'bad-q', error: expect.any(String) } },
      ]);
      expect(driver.answer('bad-q', 'A').ok).toBe(false);
    },
  );

  it('answers a tool request with no tool name or input, and an unsupported request kind, with an error', async () => {
    const { id, process, only } = await started();

    process.emit(
      JSON.stringify({ type: 'control_request', request_id: 'r-1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: null } }),
      JSON.stringify({ type: 'control_request', request_id: 'r-2', request: { subtype: 'can_use_tool', input: {} } }),
      JSON.stringify({ type: 'control_request', request_id: 'r-3', request: { subtype: 'hook_callback' } }),
      JSON.stringify({ type: 'control_request', request_id: 'r-4', request: null }),
    );

    expect(only(id).slice(1).map((m) => m.type)).toEqual(['error', 'error', 'error', 'error']);
    expect(process.writtenEvents.map((e) => (e as { response: { request_id: string; subtype: string } }).response)).toEqual(
      ['r-1', 'r-2', 'r-3', 'r-4'].map((requestId) => expect.objectContaining({ subtype: 'error', request_id: requestId })),
    );
  });

  it('reports a repeated request id as an error and still answers the first request exactly once', async () => {
    const { id, driver, process, only } = await started();

    process.emit(recorded.permissionRequest, recorded.permissionRequest);
    driver.allow(PERMISSION_REQUEST_ID);
    process.emit(recorded.permissionRequest);

    expect(only(id).slice(1).map((m) => m.type)).toEqual(['permission', 'error', 'error']);
    expect(process.writtenEvents).toHaveLength(1);
    expect(driver.allow(PERMISSION_REQUEST_ID).ok).toBe(false);
  });

  it('routes each answer to the agent that asked', async () => {
    const { driver, processes } = setup();
    await driver.startChatAgent(request);
    await driver.startChatAgent(request);
    processes.forEach((p) => (p.written.length = 0));

    processes[1].emit(recorded.permissionRequest);
    processes[0].emit(recorded.questionRequest);
    driver.allow(PERMISSION_REQUEST_ID);
    driver.answer(QUESTION_REQUEST_ID, 'Red');

    expect(processes[0].writtenEvents).toEqual([expect.objectContaining({ response: expect.objectContaining({ request_id: QUESTION_REQUEST_ID }) })]);
    expect(processes[1].writtenEvents).toEqual([expect.objectContaining({ response: expect.objectContaining({ request_id: PERMISSION_REQUEST_ID }) })]);
  });
});

describe('chat driver: typing, stopping and exits', () => {
  it('writes the member’s message as one user line, even with line breaks, and echoes it', async () => {
    const { id, driver, process, only } = await started();

    const result = driver.send(id, 'First line\nsecond line');

    expect(result).toEqual({ ok: true });
    expect(process.written).toHaveLength(1);
    expect(process.written[0].indexOf('\n')).toBe(process.written[0].length - 1);
    expect(process.writtenEvents).toEqual([
      { type: 'user', message: { role: 'user', content: 'First line\nsecond line' } },
    ]);
    expect(only(id).at(-1)).toEqual({ type: 'user', text: 'First line\nsecond line' });
  });

  it('refuses an empty message and an unknown agent', async () => {
    const { id, driver, process } = await started();

    expect(driver.send(id, '').ok).toBe(false);
    expect(driver.send(id, 5 as never).ok).toBe(false);
    expect(driver.send('no-such-agent', 'hi').ok).toBe(false);
    expect(process.written).toEqual([]);
  });

  it('reports an exit, then forgets the agent and its open questions', async () => {
    const { id, driver, process, exits } = await started();
    process.emit(recorded.questionRequest);

    process.exit(1);

    expect(exits).toEqual([{ id, exitCode: 1 }]);
    expect(driver.answer(QUESTION_REQUEST_ID, 'Red').ok).toBe(false);
    expect(driver.send(id, 'hi').ok).toBe(false);
    expect(process.written).toEqual([]);
  });

  it('stops an agent without reporting an exit, ignores its later output, and stops all on quit', async () => {
    const { id, driver, processes, messages, exits } = await started();
    await driver.startChatAgent(request);
    const count = messages.length;

    driver.stop(id);
    driver.stop(id);
    processes[0].emit(recorded.assistantText('late'));
    processes[0].exit(0);
    driver.stopAll();

    expect(processes.map((p) => p.stopped)).toEqual([true, true]);
    expect(messages).toHaveLength(count);
    expect(exits).toEqual([]);
  });
});
