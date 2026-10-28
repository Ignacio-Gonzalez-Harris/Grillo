/**
 * Event lines in the shape the real `claude` 2.1.312 printed during the issue 107 run (stream-json, verbose,
 * permission prompts over stdio), rebuilt with made-up session ids, paths and values. Fields the driver never reads
 * are trimmed; nothing here comes from a real session.
 */
const SESSION = '00000000-0000-4000-8000-000000000001';
const FOLDER = '/home/made-up/demo-project';

export const QUESTION_REQUEST_ID = '11111111-1111-4111-8111-111111111111';
export const PERMISSION_REQUEST_ID = '22222222-2222-4222-8222-222222222222';

export const QUESTION_INPUT = {
  questions: [
    {
      question: 'Which colour?',
      header: 'Colour',
      options: [
        { label: 'Red', description: 'Write Red into colour.txt.' },
        { label: 'Blue', description: 'Write Blue into colour.txt.' },
      ],
      multiSelect: false,
    },
  ],
};

export const WRITE_INPUT = { file_path: `${FOLDER}/colour.txt`, content: 'Blue\n' };

const line = (event: unknown): string => JSON.stringify(event);

export const recorded = {
  /** Claude Code's answer to Grillo's `initialize` control request. */
  initializeResponse: (requestId: string): string =>
    line({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { commands: [] } } }),
  init: line({
    type: 'system',
    subtype: 'init',
    cwd: FOLDER,
    session_id: SESSION,
    tools: ['Task', 'AskUserQuestion', 'Bash', 'Read', 'Write'],
    model: 'claude-made-up-model',
    permissionMode: 'default',
    apiKeySource: 'none',
  }),
  assistantToolUse: line({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_made_up_1', name: 'AskUserQuestion', input: QUESTION_INPUT }],
    },
    parent_tool_use_id: null,
    session_id: SESSION,
  }),
  questionRequest: line({
    type: 'control_request',
    request_id: QUESTION_REQUEST_ID,
    request: {
      subtype: 'can_use_tool',
      tool_name: 'AskUserQuestion',
      display_name: 'AskUserQuestion',
      input: QUESTION_INPUT,
      tool_use_id: 'toolu_made_up_1',
      requires_user_interaction: true,
    },
  }),
  rateLimit: line({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' }, session_id: SESSION }),
  toolResult: line({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', content: 'answered', tool_use_id: 'toolu_made_up_1' }] },
    parent_tool_use_id: null,
    session_id: SESSION,
  }),
  permissionRequest: line({
    type: 'control_request',
    request_id: PERMISSION_REQUEST_ID,
    request: {
      subtype: 'can_use_tool',
      tool_name: 'Write',
      display_name: 'Write',
      input: WRITE_INPUT,
      description: 'colour.txt',
      permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
      tool_use_id: 'toolu_made_up_2',
    },
  }),
  thinkingTokens: line({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50, session_id: SESSION }),
  assistantText: (text: string): string =>
    line({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      session_id: SESSION,
    }),
  result: (text: string): string =>
    line({
      duration_api_ms: 1000,
      stop_reason: 'end_turn',
      session_id: SESSION,
      is_error: false,
      num_turns: 3,
      subtype: 'success',
      result: text,
      type: 'result',
    }),
};
