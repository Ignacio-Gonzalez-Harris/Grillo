/**
 * The agent runtime's contract between the main process and the renderer (PRD section 4.6, 8 Agent runtime).
 * An agent is the member's Claude Code, started in the project folder: a chat agent (the default) or, as the
 * fallback, a visible session in an embedded terminal (see `AgentRuntimeChoice`).
 */

/** The six kinds of agent (PRD section 3, Vocabulary). */
export const AGENT_KINDS = ['grilling', 'research', 'prototype', 'task', 'support', 'generic'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export type AgentId = string;

/**
 * How an agent tab's Claude Code runs (PRD section 8, Agent runtime): `chat`, the machine-readable chat agent, or
 * `terminal`, the release-1 terminal agent kept as a working fallback until the Agent SDK terms are confirmed.
 */
export const AGENT_RUNTIME_CHOICES = ['chat', 'terminal'] as const;
export type AgentRuntimeChoice = (typeof AGENT_RUNTIME_CHOICES)[number];

export interface StartAgentRequest {
  kind: AgentKind;
  /** The project folder: Claude Code starts here and the skills are shipped here. */
  folder: string;
  /** Sent as the first chat message, or typed with Enter once a terminal agent's prompt appears. Empty sends nothing. */
  firstMessage: string;
  /** The tab's name, usually `agentTitle(kind, ticket)`. */
  title: string;
}

/** One running agent, as the tab bar shows it. */
export interface AgentInfo {
  id: AgentId;
  kind: AgentKind;
  title: string;
  folder: string;
  /** True once the agent has gone quiet after output: the tab's dot (it is waiting for the member). */
  waiting: boolean;
  /** `chat` on a chat agent, whose tab shows the chat view; a terminal agent leaves it out (the release-1 shape). */
  runtime?: AgentRuntimeChoice;
}

/** The tab name "<kind> · <ticket>", as in "Grilling · Login flow". */
export function agentTitle(kind: AgentKind, ticket: string): string {
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} · ${ticket}`;
}

declare module './ipc' {
  interface InvokeChannels {
    'agents:start': { request: StartAgentRequest; response: AgentId };
    'agents:write': { request: { id: AgentId; text: string }; response: void };
    /** One whole message to the agent: a chat message, or typed text followed by Enter on a terminal agent. */
    'agents:send': { request: { id: AgentId; text: string }; response: void };
    'agents:resize': { request: { id: AgentId; cols: number; rows: number }; response: void };
    'agents:stop': { request: { id: AgentId }; response: void };
    'agents:set-title': { request: { id: AgentId; title: string }; response: void };
    'agents:list': { request: void; response: AgentInfo[] };
  }
  interface EventChannels {
    /** Terminal output of one agent, as raw text for the terminal view. */
    'agents:output': { id: AgentId; data: string };
    /** The whole agent list, sent whenever an agent starts, stops, is renamed or its waiting flag changes. */
    'agents:list-changed': AgentInfo[];
    /** An agent's Claude Code process ended on its own (not through stop). */
    'agents:exited': { id: AgentId; exitCode: number };
  }
}
