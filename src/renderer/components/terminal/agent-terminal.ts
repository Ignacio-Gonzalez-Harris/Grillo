/**
 * Wires a terminal to one agent through the agent runtime IPC: its output in, the member's keystrokes and the
 * terminal's size out (`agents:output`, `agents:write`, `agents:resize`).
 */
import type { AgentId } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import type { TerminalView } from './terminal-view';

const ENTER = '\r';

export interface AgentTerminal {
  /** Gives the agent the terminal's current size, unless the agent already has it. */
  syncSize(): void;
  /** Stops showing output and sending keys; the terminal itself stays the caller's. */
  dispose(): void;
}

function warnUnreachable(agentId: AgentId): (error: unknown) => void {
  return (error) => console.warn(`Grillo could not reach agent ${agentId}; it has probably stopped.`, error);
}

function isOutputFor(agentId: AgentId, payload: unknown): payload is { id: AgentId; data: string } {
  const candidate = payload as { id?: unknown; data?: unknown } | null;
  return typeof candidate === 'object' && candidate?.id === agentId && typeof candidate.data === 'string';
}

function write(grillo: GrilloApi, agentId: AgentId, text: string): Promise<void> {
  return grillo.invoke('agents:write', { id: agentId, text });
}

/**
 * Types a line from the type box into the agent, then presses Enter as a write of its own, as a member does
 * (Claude Code reads text and Enter in one write as a paste). An empty line presses Enter alone.
 */
export async function sendLine(grillo: GrilloApi, agentId: AgentId, text: string): Promise<void> {
  try {
    if (text !== '') await write(grillo, agentId, text);
    await write(grillo, agentId, ENTER);
  } catch (error) {
    warnUnreachable(agentId)(error);
  }
}

export function connectAgentTerminal(grillo: GrilloApi, agentId: AgentId, view: TerminalView): AgentTerminal {
  let sentSize: { cols: number; rows: number } | undefined;

  function sendSize(cols: number, rows: number): void {
    if (sentSize?.cols === cols && sentSize.rows === rows) return;
    sentSize = { cols, rows };
    grillo.invoke('agents:resize', { id: agentId, cols, rows }).catch(warnUnreachable(agentId));
  }

  const stops = [
    grillo.on('agents:output', (payload: unknown) => {
      if (isOutputFor(agentId, payload)) view.write(payload.data);
    }),
    view.onData((data) => {
      write(grillo, agentId, data).catch(warnUnreachable(agentId));
    }),
    view.onResize(({ cols, rows }) => sendSize(cols, rows)),
  ];

  return {
    syncSize: () => sendSize(view.cols, view.rows),
    dispose: () => stops.forEach((stop) => stop()),
  };
}
