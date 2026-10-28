import type { ChatQuestionItem } from '../../../shared/agent-chat';

/**
 * Reads Claude Code's stream-json output (one JSON event per line). The input is untrusted: every line that does not
 * have the expected shape becomes an `error` event, never a thrown exception. Event types it does not know are
 * `ignored`, because Claude Code adds new ones between versions.
 */
export type StreamEvent =
  | { kind: 'init'; sessionId: string; model: string; tools: string[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'result'; isError: boolean; text: string }
  | { kind: 'question'; requestId: string; input: Record<string, unknown>; questions: ChatQuestionItem[] }
  | {
      kind: 'permission';
      requestId: string;
      toolName: string;
      input: Record<string, unknown>;
      description: string;
    }
  /** A control request with a readable id that cannot be served: Claude Code must still get an answer. */
  | { kind: 'refused-request'; requestId: string; message: string }
  /** Claude Code's answer to a control request Grillo sent. */
  | { kind: 'control-response'; requestId: string; error: string | undefined }
  | { kind: 'ignored' }
  | { kind: 'error'; message: string };

const ASK_USER_QUESTION = 'AskUserQuestion';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function error(message: string): StreamEvent {
  return { kind: 'error', message };
}

/** Splits stdout chunks into whole lines, keeping a partial line until the rest arrives. */
export function createLineSplitter(): { push(chunk: string): string[]; flush(): string[] } {
  let pending = '';
  const clean = (lines: string[]): string[] =>
    lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)).filter((line) => line.trim() !== '');
  return {
    push(chunk) {
      const parts = (pending + chunk).split('\n');
      pending = parts.pop() ?? '';
      return clean(parts);
    },
    flush() {
      const rest = pending;
      pending = '';
      return clean([rest]);
    },
  };
}

function parseInit(event: JsonObject): StreamEvent {
  const { session_id: sessionId, model, tools } = event;
  if (!isText(sessionId) || typeof model !== 'string' || !Array.isArray(tools) || !tools.every(isText)) {
    return error('Claude Code started a turn, but its session, model or tool list could not be read');
  }
  return { kind: 'init', sessionId, model, tools: [...tools] };
}

function parseAssistant(event: JsonObject): StreamEvent {
  const content = isObject(event.message) ? event.message.content : undefined;
  if (!Array.isArray(content) || !content.every(isObject)) {
    return error('An assistant message could not be read: its content is not a list of blocks');
  }
  const textBlocks = content.filter((block) => block.type === 'text');
  if (!textBlocks.every((block) => typeof block.text === 'string')) {
    return error('An assistant message could not be read: a text block has no text');
  }
  // A sub-agent's messages carry the tool call that started it; only the agent's own words become bubbles.
  if (isText(event.parent_tool_use_id) || textBlocks.length === 0) {
    return { kind: 'ignored' };
  }
  return { kind: 'assistant', text: textBlocks.map((block) => block.text as string).join('\n') };
}

function parseResult(event: JsonObject): StreamEvent {
  const { subtype, is_error: isError, result } = event;
  if (typeof subtype !== 'string' || (result !== undefined && typeof result !== 'string')) {
    return error('The end of a turn could not be read');
  }
  return { kind: 'result', isError: isError === true || subtype !== 'success', text: result ?? '' };
}

function parseQuestions(input: JsonObject): ChatQuestionItem[] | undefined {
  const { questions } = input;
  if (!Array.isArray(questions) || questions.length === 0) {
    return undefined;
  }
  const items: ChatQuestionItem[] = [];
  for (const item of questions) {
    if (!isObject(item) || !isText(item.question) || !Array.isArray(item.options)) {
      return undefined;
    }
    const options = item.options.map((option: unknown) =>
      isObject(option) && isText(option.label)
        ? { label: option.label, description: typeof option.description === 'string' ? option.description : '' }
        : undefined,
    );
    if (options.length === 0 || options.some((option) => option === undefined)) {
      return undefined;
    }
    items.push({
      question: item.question,
      header: typeof item.header === 'string' ? item.header : '',
      options: options as ChatQuestionItem['options'],
      multiSelect: item.multiSelect === true,
    });
  }
  return items;
}

function parseControlRequest(event: JsonObject): StreamEvent {
  const { request_id: requestId, request } = event;
  if (!isText(requestId)) {
    return error('Claude Code asked something without an id, so it cannot be answered');
  }
  const refuse = (message: string): StreamEvent => ({ kind: 'refused-request', requestId, message });
  if (!isObject(request) || request.subtype !== 'can_use_tool') {
    return refuse('Grillo does not handle this kind of control request');
  }
  const { tool_name: toolName, input, description } = request;
  if (!isText(toolName) || !isObject(input)) {
    return refuse('A tool request had no tool name or input');
  }
  if (toolName === ASK_USER_QUESTION) {
    const questions = parseQuestions(input);
    return questions ? { kind: 'question', requestId, input, questions } : refuse('A question could not be read');
  }
  return {
    kind: 'permission',
    requestId,
    toolName,
    input,
    description: typeof description === 'string' ? description : '',
  };
}

function parseControlResponse(event: JsonObject): StreamEvent {
  const { response } = event;
  if (!isObject(response) || !isText(response.request_id)) {
    return error('Claude Code answered a control request that cannot be identified');
  }
  const failed = response.subtype !== 'success';
  return {
    kind: 'control-response',
    requestId: response.request_id,
    error: failed ? (typeof response.error === 'string' ? response.error : 'unknown error') : undefined,
  };
}

/** Reads one event line. */
export function parseEventLine(line: string): StreamEvent {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return error('A line from Claude Code is not valid JSON');
  }
  if (!isObject(event) || typeof event.type !== 'string') {
    return error('A line from Claude Code is not an event');
  }
  switch (event.type) {
    case 'system':
      return event.subtype === 'init' ? parseInit(event) : { kind: 'ignored' };
    case 'assistant':
      return parseAssistant(event);
    case 'result':
      return parseResult(event);
    case 'control_request':
      return parseControlRequest(event);
    case 'control_response':
      return parseControlResponse(event);
    default:
      return { kind: 'ignored' };
  }
}
