/**
 * The agent runtime's contract between the main process and the renderer (PRD section 4.6, 8 Agent runtime).
 * An agent is a visible Claude Code session in an embedded terminal, started in the project folder.
 */

/** The six kinds of agent (PRD section 3, Vocabulary). */
export const AGENT_KINDS = ['grilling', 'research', 'prototype', 'task', 'support', 'generic'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export type AgentId = string;

export interface StartAgentRequest {
  kind: AgentKind;
  /** The project folder: Claude Code starts here and the skills are shipped here. */
  folder: string;
  /** Typed into Claude Code, followed by Enter, once its prompt appears. An empty message types nothing. */
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
}

/** The tab name "<kind> · <ticket>", as in "Grilling · Login flow". */
export function agentTitle(kind: AgentKind, ticket: string): string {
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} · ${ticket}`;
}

declare module './ipc' {
  interface InvokeChannels {
    'agents:start': { request: StartAgentRequest; response: AgentId };
    'agents:write': { request: { id: AgentId; text: string }; response: void };
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
