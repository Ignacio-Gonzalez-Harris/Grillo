/**
 * The agent chat protocol's contract between the main process and the renderer (PRD section 4.6 items 1 and 7,
 * section 8 Agent runtime decision [I2]). A chat agent is the member's own Claude Code run in machine-readable mode:
 * no terminal, a typed message stream instead.
 */
import type { AgentKind } from './agents';

export type ChatAgentId = string;

export interface StartChatAgentRequest {
  kind: AgentKind;
  /** The project folder: Claude Code starts here and the skills are shipped here. */
  folder: string;
  /** Sent as the agent's first message. An empty message sends nothing. */
  firstMessage: string;
}

/** One option of a clickable-options question (Claude Code's `AskUserQuestion` tool). */
export interface ChatQuestionOption {
  label: string;
  description: string;
}

export interface ChatQuestionItem {
  question: string;
  header: string;
  options: ChatQuestionOption[];
  multiSelect: boolean;
}

/** Everything a chat agent says, in the order it said it. */
export type ChatMessage =
  /** Claude Code started a turn (`system/init`). */
  | { type: 'init'; sessionId: string; model: string; tools: string[] }
  /** Assistant text, one bubble. */
  | { type: 'assistant'; text: string }
  /** A message Grillo wrote into the agent's input: the member's typing, the first message or a relay. */
  | { type: 'user'; text: string }
  /** Clickable options waiting for `answer(id, option)` (or `deny(id)` to dismiss them). */
  | { type: 'question'; id: string; questions: ChatQuestionItem[] }
  /** A tool waiting for `allow(id)` or `deny(id)`. */
  | { type: 'permission'; id: string; toolName: string; input: Record<string, unknown>; description: string }
  /** The turn ended. */
  | { type: 'result'; isError: boolean; text: string }
  /** The member's answer, allow or deny for question or permission `id` went to Claude Code: the agent works on. */
  | { type: 'answered'; id: string }
  /** Claude Code withdrew question or permission `id` before it was answered: its buttons go. */
  | { type: 'cancelled'; id: string }
  /** A tool ran, or the agent thought, while Grillo showed it waiting: the agent is at work again. */
  | { type: 'working' }
  /** Claude Code ended with an error; the message holds the exit code and the last lines of its own error text. */
  | { type: 'failed'; message: string }
  /** Something in the stream could not be read; the agent carries on. */
  | { type: 'error'; message: string };

/**
 * The answer to every action on a chat agent. An action that cannot be done (an unknown agent, an id already
 * answered, an empty message) is `ok: false` with the reason, never a thrown error.
 */
export type ChatActionResult = { ok: true } | { ok: false; reason: string };

/** A question's answer: the chosen label (or free text) when it asks one thing, else question text → answer. */
export type ChatAnswer = string | Readonly<Record<string, string>>;

declare module './ipc' {
  interface InvokeChannels {
    'agent-chat:start': { request: StartChatAgentRequest; response: ChatAgentId };
    'agent-chat:send': { request: { id: ChatAgentId; text: string }; response: ChatActionResult };
    'agent-chat:answer': { request: { id: string; option: ChatAnswer }; response: ChatActionResult };
    'agent-chat:allow': { request: { id: string }; response: ChatActionResult };
    'agent-chat:deny': { request: { id: string }; response: ChatActionResult };
    'agent-chat:relay': {
      request: { targetAgentId: ChatAgentId; member: string; text: string };
      response: ChatActionResult;
    };
    'agent-chat:stop': { request: { id: ChatAgentId }; response: void };
  }
  interface EventChannels {
    /** One typed message from one chat agent. */
    'agent-chat:message': { id: ChatAgentId; message: ChatMessage };
    /** One raw event line, as Claude Code printed it, for the chat view's "show terminal" switch. */
    'agent-chat:raw': { id: ChatAgentId; line: string };
    /**
     * A chat agent's Claude Code ended on its own, or through `agent-chat:stop`. Null when it could not start or was
     * stopped.
     */
    'agent-chat:exited': { id: ChatAgentId; exitCode: number | null };
  }
}
