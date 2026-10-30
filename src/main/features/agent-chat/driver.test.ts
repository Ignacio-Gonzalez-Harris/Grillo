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

/** A clickable-options question with its own request id. */
function questionLine(requestId: string): string {
  return recorded.questionRequest.replace(QUESTION_REQUEST_ID, requestId);
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

    expect(only(id).at(-2)).toEqual({ type: 'question', id: QUESTION_REQUEST_ID, questions: QUESTION_INPUT.questions });
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

    expect(only(id).at(-2)).toEqual({
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

    expect(only(id).slice(1).map((m) => m.type)).toEqual(['permission', 'error', 'answered', 'error']);
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
    processes[0].printError('late error\n');
    processes[0].exit(1);
    driver.stopAll();

    expect(processes.map((p) => p.stopped)).toEqual([true, true]);
    expect(messages).toHaveLength(count);
    expect(exits).toEqual([]);
  });

  it('says whether a stop ended a running agent', async () => {
    const { id, driver } = await started();

    expect(driver.stop(id)).toBe(true);
    expect(driver.stop(id)).toBe(false);
    expect(driver.stop('no-such-agent')).toBe(false);
  });
});

describe('chat driver: what the agent is doing after an answer', () => {
  it('says the agent works on once the member answers, allows or denies', async () => {
    const { id, driver, process, only } = await started();
    process.emit(recorded.questionRequest, recorded.permissionRequest);

    driver.answer(QUESTION_REQUEST_ID, 'Blue');
    driver.allow(PERMISSION_REQUEST_ID);
    process.emit(questionLine('q-2'), recorded.permissionRequest.replace(PERMISSION_REQUEST_ID, 'p-2'));
    driver.deny('q-2');
    driver.deny('p-2');

    expect(only(id).filter(({ type }) => type === 'answered')).toEqual([
      { type: 'answered', id: QUESTION_REQUEST_ID },
      { type: 'answered', id: PERMISSION_REQUEST_ID },
      { type: 'answered', id: 'q-2' },
      { type: 'answered', id: 'p-2' },
    ]);
  });

  it('says nothing more for an answer it refuses', async () => {
    const { id, driver, process, only } = await started();
    process.emit(recorded.questionRequest);
    const before = only(id).length;

    driver.answer(QUESTION_REQUEST_ID, '');
    driver.allow(QUESTION_REQUEST_ID);
    driver.answer('no-such-request', 'Blue');

    expect(only(id)).toHaveLength(before);
  });

  it('counts tool events as work: one working message once the agent waited, none while it already works', async () => {
    const { id, process, only } = await started();

    process.emit(recorded.assistantToolUse, recorded.toolResult);
    expect(only(id).slice(1)).toEqual([]);

    process.emit(recorded.result('Sample turn end'), recorded.assistantToolUse, recorded.toolResult, recorded.assistantToolUse);
    expect(only(id).slice(1)).toEqual([{ type: 'result', isError: false, text: 'Sample turn end' }, { type: 'working' }]);
  });

  it('counts a sub-agent message as work once the agent waited', async () => {
    const { id, process, only } = await started();

    process.emit(
      recorded.questionRequest,
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Sub' }] }, parent_tool_use_id: 'toolu_x' }),
    );

    expect(only(id).at(-1)).toEqual({ type: 'working' });
  });
});

describe('chat driver: questions Claude Code withdraws', () => {
  it('drops a cancelled question or permission, so it can no longer be answered, and says so once', async () => {
    const { id, driver, process, only } = await started();
    process.emit(recorded.questionRequest, recorded.permissionRequest);

    process.emit(recorded.cancelRequest(QUESTION_REQUEST_ID), recorded.cancelRequest(PERMISSION_REQUEST_ID));

    expect(only(id).slice(-2)).toEqual([
      { type: 'cancelled', id: QUESTION_REQUEST_ID },
      { type: 'cancelled', id: PERMISSION_REQUEST_ID },
    ]);
    expect(driver.answer(QUESTION_REQUEST_ID, 'Blue').ok).toBe(false);
    expect(driver.allow(PERMISSION_REQUEST_ID).ok).toBe(false);
    expect(process.written).toEqual([]);
  });

  it("ignores a repeated cancel, and a cancel that crossed the member's answer", async () => {
    const { id, driver, process, only } = await started();
    process.emit(recorded.questionRequest, recorded.permissionRequest);
    driver.answer(QUESTION_REQUEST_ID, 'Blue');
    const before = only(id).length;

    process.emit(
      recorded.cancelRequest(QUESTION_REQUEST_ID),
      recorded.cancelRequest(PERMISSION_REQUEST_ID),
      recorded.cancelRequest(PERMISSION_REQUEST_ID),
    );

    expect(only(id).slice(before)).toEqual([{ type: 'cancelled', id: PERMISSION_REQUEST_ID }]);
  });

  const badCancels: Array<[string, string]> = [
    ['a cancel with no id', '{"type":"control_cancel_request"}'],
    ['a cancel with a null id', '{"type":"control_cancel_request","request_id":null}'],
    ['a cancel with an empty id', '{"type":"control_cancel_request","request_id":""}'],
    ['a cancel with a number for an id', '{"type":"control_cancel_request","request_id":7}'],
    ['a cancel for a request never asked', recorded.cancelRequest('never-asked')],
  ];

  it.each(badCancels)('turns %s into one error message, keeping the open question', async (_name, line) => {
    const { id, driver, process, only } = await started();
    process.emit(recorded.questionRequest);
    const before = only(id).length;

    expect(() => process.emit(line)).not.toThrow();

    expect(only(id).slice(before)).toEqual([{ type: 'error', message: expect.any(String) }]);
    expect(driver.answer(QUESTION_REQUEST_ID, 'Blue').ok).toBe(true);
  });

  it("never lets one agent cancel another agent's question", async () => {
    const { driver, processes, only } = await started();
    const other = await driver.startChatAgent(request);
    processes[0].emit(recorded.questionRequest);

    processes[1].emit(recorded.cancelRequest(QUESTION_REQUEST_ID));

    expect(only(other).at(-1)).toMatchObject({ type: 'error' });
    expect(driver.answer(QUESTION_REQUEST_ID, 'Blue').ok).toBe(true);
  });
});

describe("chat driver: Claude Code's own error text when it ends badly", () => {
  it('shows the last lines of its error text, with the exit code, before reporting the end', async () => {
    const { id, process, only, exits, messages } = await started();

    process.printError("\u001b[31mError: unknown option '--made-up'\u001b[0m\r\n");
    process.printError('Run claude --help for us');
    process.printError('age.\n');
    process.exit(1);

    const failed = only(id).at(-1);
    expect(failed).toEqual({ type: 'failed', message: expect.stringContaining('exit code 1') });
    const text = (failed as { message: string }).message;
    expect(text).toContain("Error: unknown option '--made-up'\nRun claude --help for usage.");
    expect(text).not.toContain('\u001b');
    expect(exits).toEqual([{ id, exitCode: 1 }]);
    expect(messages.at(-1)?.message.type).toBe('failed');
  });

  it('keeps only the last lines of a long error text, each cut to a readable length', async () => {
    const { id, process, only } = await started();

    process.printError(Array.from({ length: 30 }, (_, n) => `made-up line ${n}`).join('\n'));
    process.printError(`\n${'x'.repeat(5000)}\n`);
    process.exit(2);

    const text = (only(id).at(-1) as { message: string }).message;
    expect(text).not.toContain('made-up line 20\n');
    expect(text).toContain('made-up line 29');
    expect(text.length).toBeLessThan(2000);
  });

  it('says it could not start when it ended with no exit code, and that it printed no error text', async () => {
    const { id, process, only } = await started();

    process.exit(null);

    expect(only(id).at(-1)).toEqual({ type: 'failed', message: expect.stringMatching(/could not start.*no error text/s) });
  });

  it('says nothing more when it ends well, even after printing to its error text', async () => {
    const { id, process, only } = await started();
    process.printError('a made-up warning\n');
    const before = only(id).length;

    process.exit(0);

    expect(only(id)).toHaveLength(before);
  });
});
