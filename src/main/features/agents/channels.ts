import type { AgentRuntimeChoice } from '../../../shared/agents';
import type { MainIpc } from '../../ipc/bridge';
import { createChatAgentRuntime, type ChatAgentRuntimeDeps } from './chat-runtime';
import { createAgentRuntime, type AgentRuntime, type AgentRuntimeDeps, type AgentRuntimeEvents } from './runtime';

/** What each runtime needs besides its events; only the chosen one is built. */
export interface AgentRuntimeOptions {
  terminal: Omit<AgentRuntimeDeps, 'events'>;
  chat: Omit<ChatAgentRuntimeDeps, 'events'>;
}

function rendererEvents(ipc: MainIpc): AgentRuntimeEvents {
  return {
    output: (id, data) => ipc.send('agents:output', { id, data }),
    exited: (id, exitCode) => ipc.send('agents:exited', { id, exitCode }),
    listChanged: (list) => ipc.send('agents:list-changed', list),
  };
}

function answerAgentChannels(ipc: MainIpc, runtime: AgentRuntime): AgentRuntime {
  ipc.handle('agents:start', (request) => runtime.startAgent(request));
  ipc.handle('agents:write', ({ id, text }) => runtime.write(id, text));
  ipc.handle('agents:send', ({ id, text }) => runtime.send(id, text));
  ipc.handle('agents:resize', ({ id, cols, rows }) => runtime.resize(id, cols, rows));
  ipc.handle('agents:stop', ({ id }) => runtime.stop(id));
  ipc.handle('agents:set-title', ({ id, title }) => runtime.setTitle(id, title));
  ipc.handle('agents:list', () => runtime.list());
  return runtime;
}

/** Builds the terminal agent runtime with its events sent to the renderer, and answers the renderer's agent channels. */
export function registerAgentChannels(ipc: MainIpc, deps: Omit<AgentRuntimeDeps, 'events'>): AgentRuntime {
  return answerAgentChannels(ipc, createAgentRuntime({ ...deps, events: rendererEvents(ipc) }));
}

/** The same channels over the chosen runtime: every agent tab is a chat agent, or every one a terminal agent. */
export function registerChosenAgentChannels(
  ipc: MainIpc,
  choice: AgentRuntimeChoice,
  options: AgentRuntimeOptions,
): AgentRuntime {
  if (choice === 'terminal') return registerAgentChannels(ipc, options.terminal);
  return answerAgentChannels(ipc, createChatAgentRuntime({ ...options.chat, events: rendererEvents(ipc) }));
}
