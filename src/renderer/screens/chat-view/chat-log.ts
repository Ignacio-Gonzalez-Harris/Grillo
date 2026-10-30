/**
 * Every chat agent's messages and raw event lines from the moment the shell starts (PRD section 4.6 item 1), so a
 * chat view mounted when its tab appears still shows what the agent was sent before that, its first message included.
 *
 * The events come from Claude Code through main, so their shape is checked here: a message that cannot be read
 * becomes one `error` message, the one error path the chat view shows; an event that names no agent is dropped.
 */
import type { ChatMessage, ChatQuestionItem } from '../../../shared/agent-chat';
import type { AgentId } from '../../../shared/agents';
import type { GrilloApi, Unsubscribe } from '../../../shared/ipc';

/** The start of the error a message that cannot be read becomes. */
export const UNREADABLE_MESSAGE = 'Grillo could not read a message from the agent';
/** Raw lines kept per agent for the "show terminal" switch; older ones drop off, as a terminal's scrollback does. */
export const MAX_RAW_LINES = 2000;

export interface ChatLogListener {
  message(message: ChatMessage): void;
  raw(line: string): void;
}

export interface ChatLog {
  /** Hands `listener` everything the agent said so far, then each new message and raw line as it comes. */
  follow(agentId: AgentId, listener: ChatLogListener): Unsubscribe;
  /** Drops an agent's history: its tab has gone. */
  forget(agentId: AgentId): void;
  /** Stops listening to the chat channels. */
  dispose(): void;
}

interface AgentHistory {
  messages: ChatMessage[];
  raw: string[];
  /** Ids of the questions and permissions shown, so one Claude Code repeats is shown, and answered, once. */
  requestIds: Set<string>;
  listeners: Set<ChatLogListener>;
}

type Fields = Record<string, unknown>;

const isText = (value: unknown): value is string => typeof value === 'string';
const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isQuestionItem(value: unknown): value is ChatQuestionItem {
  return (
    isObject(value) &&
    isText(value['question']) &&
    isText(value['header']) &&
    typeof value['multiSelect'] === 'boolean' &&
    Array.isArray(value['options']) &&
    value['options'].length > 0 &&
    value['options'].every((option) => isObject(option) && isText(option['label']) && isText(option['description']))
  );
}

/** The message, when its fields have the shape the agent chat protocol promises; else why not. */
function checked(value: unknown): ChatMessage | string {
  if (!isObject(value)) return 'it is not an object';
  const m = value;
  switch (m['type']) {
    case 'init':
      if (isText(m['sessionId']) && isText(m['model']) && Array.isArray(m['tools']) && m['tools'].every(isText)) {
        return { type: 'init', sessionId: m['sessionId'], model: m['model'], tools: [...m['tools']] };
      }
      break;
    case 'assistant':
    case 'user':
      if (isText(m['text'])) return { type: m['type'], text: m['text'] };
      break;
    case 'question':
      if (isText(m['id']) && m['id'] !== '' && Array.isArray(m['questions']) && m['questions'].length > 0) {
        const questions = m['questions'];
        if (questions.every(isQuestionItem)) return { type: 'question', id: m['id'], questions };
      }
      break;
    case 'permission':
      if (isText(m['id']) && m['id'] !== '' && isText(m['toolName']) && isObject(m['input']) && isText(m['description'])) {
        return { type: 'permission', id: m['id'], toolName: m['toolName'], input: m['input'], description: m['description'] };
      }
      break;
    case 'result':
      if (typeof m['isError'] === 'boolean' && isText(m['text'])) {
        return { type: 'result', isError: m['isError'], text: m['text'] };
      }
      break;
    case 'answered':
    case 'cancelled':
      if (isText(m['id']) && m['id'] !== '') return { type: m['type'], id: m['id'] };
      break;
    case 'working':
      return { type: 'working' };
    case 'error':
    case 'failed':
      if (isText(m['message'])) return { type: m['type'], message: m['message'] };
      break;
    default:
      return `its type ${JSON.stringify(m['type']) ?? 'is missing'} is not one the chat view knows`;
  }
  return `a '${String(m['type'])}' message is missing a field or has one of the wrong kind`;
}

/** A chat message as the view may trust it: malformed input becomes an `error` message saying so. */
export function readChatMessage(value: unknown): ChatMessage {
  const message = checked(value);
  return typeof message === 'string' ? { type: 'error', message: `${UNREADABLE_MESSAGE}: ${message}.` } : message;
}

/** The agent an event belongs to, or undefined when it names none. */
function agentOf(payload: unknown): AgentId | undefined {
  const id = isObject(payload) ? payload['id'] : undefined;
  return isText(id) && id !== '' ? id : undefined;
}

export function createChatLog(grillo: GrilloApi): ChatLog {
  const histories = new Map<AgentId, AgentHistory>();

  function historyOf(agentId: AgentId): AgentHistory {
    let history = histories.get(agentId);
    if (!history) {
      history = { messages: [], raw: [], requestIds: new Set(), listeners: new Set() };
      histories.set(agentId, history);
    }
    return history;
  }

  function addMessage(payload: unknown): void {
    const agentId = agentOf(payload);
    if (agentId === undefined) {
      console.warn('A chat message named no agent; it is not shown.', payload);
      return;
    }
    const history = historyOf(agentId);
    const message = readChatMessage((payload as Fields)['message']);
    if (message.type === 'question' || message.type === 'permission') {
      if (history.requestIds.has(message.id)) return;
      history.requestIds.add(message.id);
    }
    history.messages.push(message);
    history.listeners.forEach((listener) => listener.message(message));
  }

  function addRaw(payload: unknown): void {
    const agentId = agentOf(payload);
    const line = isObject(payload) ? payload['line'] : undefined;
    if (agentId === undefined || !isText(line)) {
      console.warn('A raw event line named no agent or held no text; it is not shown.', payload);
      return;
    }
    const history = historyOf(agentId);
    history.raw.push(line);
    if (history.raw.length > MAX_RAW_LINES) history.raw.shift();
    history.listeners.forEach((listener) => listener.raw(line));
  }

  const forget = (agentId: AgentId): void => {
    histories.delete(agentId);
  };

  const stops: Unsubscribe[] = [
    grillo.on('agent-chat:message', addMessage),
    grillo.on('agent-chat:raw', addRaw),
    grillo.on('agent-chat:exited', (payload: unknown) => {
      const agentId = agentOf(payload);
      if (agentId !== undefined) forget(agentId);
    }),
  ];

  return {
    follow(agentId, listener) {
      const history = historyOf(agentId);
      history.messages.forEach((message) => listener.message(message));
      history.raw.forEach((line) => listener.raw(line));
      history.listeners.add(listener);
      return () => {
        history.listeners.delete(listener);
      };
    },
    forget,
    dispose() {
      stops.forEach((stop) => stop());
      histories.clear();
    },
  };
}

let appLog: { grillo: GrilloApi; log: ChatLog } | undefined;

/** The app's one chat log, started with the shell (`index.ts`) so it hears every agent from its first message. */
export function appChatLog(grillo: GrilloApi): ChatLog {
  if (appLog?.grillo !== grillo) {
    appLog?.log.dispose();
    appLog = { grillo, log: createChatLog(grillo) };
  }
  return appLog.log;
}

/** Stops the app's chat log; the next `appChatLog` starts a new one. */
export function stopAppChatLog(): void {
  appLog?.log.dispose();
  appLog = undefined;
}
