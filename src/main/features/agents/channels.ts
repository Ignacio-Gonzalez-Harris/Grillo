import type { MainIpc } from '../../ipc/bridge';
import { createAgentRuntime, type AgentRuntime, type AgentRuntimeDeps } from './runtime';

/** Builds the agent runtime with its events sent to the renderer, and answers the renderer's agent channels. */
export function registerAgentChannels(ipc: MainIpc, deps: Omit<AgentRuntimeDeps, 'events'>): AgentRuntime {
  const runtime = createAgentRuntime({
    ...deps,
    events: {
      output: (id, data) => ipc.send('agents:output', { id, data }),
      exited: (id, exitCode) => ipc.send('agents:exited', { id, exitCode }),
      listChanged: (list) => ipc.send('agents:list-changed', list),
    },
  });

  ipc.handle('agents:start', (request) => runtime.startAgent(request));
  ipc.handle('agents:write', ({ id, text }) => runtime.write(id, text));
  ipc.handle('agents:resize', ({ id, cols, rows }) => runtime.resize(id, cols, rows));
  ipc.handle('agents:stop', ({ id }) => runtime.stop(id));
  ipc.handle('agents:set-title', ({ id, title }) => runtime.setTitle(id, title));
  ipc.handle('agents:list', () => runtime.list());
  return runtime;
}
