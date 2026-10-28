import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentChannels } from '../../../main/features/agents/channels';
import { FakePty } from '../../../main/features/agents/fake-pty';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { createGrilloApi } from '../../../preload/bridge';
import { connectAgentTerminal, sendLine } from './agent-terminal';
import { FakeTerminalView } from './fake-terminal-view';

/** The real agent channels over the IPC fake, with Claude Code played by fake terminals. */
async function connect() {
  const fake = createFakeIpc();
  const ptys: FakePty[] = [];
  registerAgentChannels(createMainIpc(fake.main, () => [fake.window]), {
    findClaude: () => '/opt/made-up/bin/claude',
    shipSkills: async () => undefined,
    spawnPty: (file, args, options) => {
      const pty = new FakePty(file, args, options);
      ptys.push(pty);
      return pty;
    },
    env: {},
  });
  const grillo = createGrilloApi(fake.renderer);
  const start = (title: string) =>
    grillo.invoke('agents:start', { kind: 'grilling', folder: '/projects/sample-1', firstMessage: '', title });
  const id = await start('Grilling · Sample ticket 1');
  const otherId = await start('Generic · Sample note');
  return { grillo, window: fake.window, pty: ptys[0], otherPty: ptys[1], id, otherId };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.restoreAllMocks());

describe('agent terminal wiring (the IPC fake)', () => {
  it("streams this agent's output into the terminal and nothing else", async () => {
    const { grillo, window, pty, otherPty, id } = await connect();
    const view = new FakeTerminalView();
    connectAgentTerminal(grillo, id, view);

    pty.print('Sample question 1.1\r\n');
    otherPty.print('another agent talking');
    for (const payload of [null, 'text', 42, [], {}, { id }, { id, data: 7 }, { id: 9, data: 'x' }, { data: 'no id' }]) {
      window.send('agents:output', payload);
    }
    pty.print('❯ ');

    expect(view.text).toBe('Sample question 1.1\r\n❯ ');
  });

  it('sends what the member types in the terminal to the agent, keystroke by keystroke', async () => {
    const { grillo, pty, id } = await connect();
    const view = new FakeTerminalView();
    connectAgentTerminal(grillo, id, view);

    view.type('1');
    view.type('\r');
    await flush();

    expect(pty.written).toEqual(['1', '\r']);
  });

  it("gives the agent the terminal's size once on sync and again on every change, never twice the same", async () => {
    const { grillo, pty, id } = await connect();
    const view = new FakeTerminalView();
    const terminal = connectAgentTerminal(grillo, id, view);

    terminal.syncSize();
    terminal.syncSize();
    view.sizeToFit = { cols: 132, rows: 40 };
    view.fit();
    terminal.syncSize();
    await flush();

    expect(pty.sizes).toEqual([
      [80, 24],
      [132, 40],
    ]);
  });

  it('types a type-box line and then presses Enter, as two separate writes', async () => {
    const { grillo, pty, id } = await connect();

    await sendLine(grillo, id, 'Sample answer B');
    await sendLine(grillo, id, '');

    expect(pty.written).toEqual(['Sample answer B', '\r', '\r']);
  });

  it('stops showing output and sending keys once disconnected', async () => {
    const { grillo, pty, id } = await connect();
    const view = new FakeTerminalView();
    const terminal = connectAgentTerminal(grillo, id, view);

    terminal.dispose();
    pty.print('after the tab closed');
    view.type('x');
    await flush();

    expect(view.written).toEqual([]);
    expect(pty.written).toEqual([]);
  });

  it('reports, never throws, when the agent has already stopped', async () => {
    const { grillo, id } = await connect();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = new FakeTerminalView();
    const terminal = connectAgentTerminal(grillo, id, view);
    await grillo.invoke('agents:stop', { id });

    view.type('x');
    terminal.syncSize();
    await sendLine(grillo, id, 'too late');
    await flush();

    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(`Grillo could not reach agent ${id}; it has probably stopped.`, expect.any(Error));
  });
});
