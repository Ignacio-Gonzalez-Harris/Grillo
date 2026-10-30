import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_ID_VARIABLE, type AgentInfo, type StartAgentRequest } from '../../../shared/agents';
import { FakePty } from './fake-pty';
import {
  ClaudeNotFoundError,
  createAgentRuntime,
  ECHO_WAIT_MS,
  ENTER_AFTER_QUIET_MS,
  findClaude,
  WAITING_AFTER_MS,
  type AgentRuntimeDeps,
} from './runtime';

const CLAUDE_PATH = '/opt/made-up/bin/claude';
const RULE = '─'.repeat(40);
/** Claude Code's input box as it reaches the terminal: a rule, then the prompt glyph and its placeholder. */
const READY_PROMPT = `\x1b[38;2;136;136;136m\r\n${RULE}\x1b[m❯ \x1b[2mTry "edit <filepath> to..."\x1b[22m`;
/** The folder-trust question Claude Code asks first in a new folder; Enter here would pick "No, exit". */
const TRUST_DIALOG =
  `${RULE}\r\n Accessing workspace: /home/ada/demo-project\r\n Quick safety check: Is this a project you trust?\r\n` +
  ` \x1b[1C❯ No, exit\r\n   Yes, I trust this folder\r\n Enter to confirm · Esc to cancel`;

const request: StartAgentRequest = {
  kind: 'grilling',
  folder: '/home/ada/demo-project',
  firstMessage: 'Start grilling the Login flow ticket',
  title: 'Grilling · Login flow',
};

function setup(overrides: Partial<AgentRuntimeDeps> = {}) {
  const ptys: FakePty[] = [];
  const steps: string[] = [];
  const output: Array<{ id: string; data: string }> = [];
  const exits: Array<{ id: string; exitCode: number }> = [];
  const lists: AgentInfo[][] = [];
  const runtime = createAgentRuntime({
    findClaude: () => CLAUDE_PATH,
    shipSkills: async (folder) => {
      steps.push(`ship ${folder}`);
    },
    spawnPty: (file, args, options) => {
      steps.push(`spawn ${file} in ${options.cwd}`);
      const pty = new FakePty(file, args, options);
      ptys.push(pty);
      return pty;
    },
    env: { PATH: '/opt/made-up/bin' },
    events: {
      output: (id, data) => output.push({ id, data }),
      exited: (id, exitCode) => exits.push({ id, exitCode }),
      listChanged: (list) => lists.push(list),
    },
    ...overrides,
  });
  return { runtime, ptys, steps, output, exits, lists };
}

describe('agent runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ships the skills, then starts claude with no extra flags in the project folder, told its own tab id, and lists the agent', async () => {
    const { runtime, ptys, steps, lists } = setup();

    const id = await runtime.startAgent(request);

    expect(steps).toEqual([`ship ${request.folder}`, `spawn ${CLAUDE_PATH} in ${request.folder}`]);
    expect(ptys[0].args).toEqual([]);
    // The agent's skills read the id to say which tab holds what (grillo-meeting, "Holding a ticket in this session").
    expect(ptys[0].options.env).toEqual({ PATH: '/opt/made-up/bin', [AGENT_ID_VARIABLE]: id });
    const expected = { id, kind: 'grilling', title: 'Grilling · Login flow', folder: request.folder, waiting: false };
    expect(runtime.list()).toEqual([expected]);
    expect(lists.at(-1)).toEqual([expected]);
  });

  it('types the first message once the prompt appears, presses Enter once its echo has settled, and only once', async () => {
    const { runtime, ptys } = setup();
    await runtime.startAgent(request);
    const pty = ptys[0];

    pty.print(TRUST_DIALOG);
    vi.advanceTimersByTime(ENTER_AFTER_QUIET_MS);
    expect(pty.written).toEqual([]);

    pty.print(READY_PROMPT);
    expect(pty.written).toEqual([request.firstMessage]);
    vi.advanceTimersByTime(ENTER_AFTER_QUIET_MS - 1);
    pty.print(`❯ ${request.firstMessage.slice(0, 10)}`);
    vi.advanceTimersByTime(ENTER_AFTER_QUIET_MS - 1);
    pty.print(request.firstMessage.slice(10));
    vi.advanceTimersByTime(ENTER_AFTER_QUIET_MS - 1);
    expect(pty.written).toEqual([request.firstMessage]);
    vi.advanceTimersByTime(1);
    expect(pty.written).toEqual([request.firstMessage, '\r']);

    pty.print(READY_PROMPT);
    vi.advanceTimersByTime(ENTER_AFTER_QUIET_MS);
    expect(pty.written).toEqual([request.firstMessage, '\r']);
  });

  it('after the trust question, presses Enter only once the typed message shows, however long Claude Code is busy', async () => {
    const { runtime, ptys } = setup();
    const id = await runtime.startAgent(request);
    const pty = ptys[0];
    pty.print(TRUST_DIALOG);
    runtime.write(id, '\x1b[B');
    runtime.write(id, '\r');

    pty.print(READY_PROMPT);
    expect(pty.written.slice(2)).toEqual([request.firstMessage]);
    vi.advanceTimersByTime(4 * ENTER_AFTER_QUIET_MS);
    pty.print('\x1b[>0q');
    vi.advanceTimersByTime(4 * ENTER_AFTER_QUIET_MS);
    expect(pty.written.slice(2)).toEqual([request.firstMessage]);

    pty.print(`\x1b[38;2;136;136;136m${RULE}\x1b[m❯ Start grilling the\r\n\x1b[K  Login flow\x1b[1Cticket\x1b[K`);
    vi.advanceTimersByTime(ENTER_AFTER_QUIET_MS - 1);
    expect(pty.written.slice(2)).toEqual([request.firstMessage]);
    vi.advanceTimersByTime(1);
    expect(pty.written.slice(2)).toEqual([request.firstMessage, '\r']);
  });

  it('presses Enter anyway when the typed message never shows in a form it recognises', async () => {
    const { runtime, ptys } = setup();
    await runtime.startAgent(request);
    const pty = ptys[0];

    pty.print(READY_PROMPT);
    vi.advanceTimersByTime(ECHO_WAIT_MS - 1);
    expect(pty.written).toEqual([request.firstMessage]);
    vi.advanceTimersByTime(1 + ENTER_AFTER_QUIET_MS);
    expect(pty.written).toEqual([request.firstMessage, '\r']);

    vi.advanceTimersByTime(ECHO_WAIT_MS);
    expect(pty.written).toEqual([request.firstMessage, '\r']);
  });

  it('recognises the prompt when it arrives split over several chunks', async () => {
    const { runtime, ptys } = setup();
    await runtime.startAgent(request);
    const pty = ptys[0];

    pty.print(READY_PROMPT.slice(0, 30));
    pty.print(READY_PROMPT.slice(30));

    expect(pty.written).toEqual([request.firstMessage]);
  });

  it('types nothing when the first message is empty', async () => {
    const { runtime, ptys } = setup();
    await runtime.startAgent({ ...request, firstMessage: '' });

    ptys[0].print(READY_PROMPT);
    vi.advanceTimersByTime(ENTER_AFTER_QUIET_MS);

    expect(ptys[0].written).toEqual([]);
  });

  it('streams output, and passes typing and resizing through to the terminal', async () => {
    const { runtime, ptys, output } = setup();
    const id = await runtime.startAgent(request);

    ptys[0].print('hello from claude');
    runtime.write(id, 'yes\r');
    runtime.resize(id, 100, 40);

    expect(output).toEqual([{ id, data: 'hello from claude' }]);
    expect(ptys[0].written).toEqual(['yes\r']);
    expect(ptys[0].sizes).toEqual([[100, 40]]);
  });

  it('raises the waiting flag after 3 seconds of silence following output, and drops it on the next output', async () => {
    const { runtime, ptys, lists } = setup();
    await runtime.startAgent(request);
    const waiting = () => runtime.list()[0].waiting;

    expect(WAITING_AFTER_MS).toBe(3000);
    vi.advanceTimersByTime(WAITING_AFTER_MS * 2);
    expect(waiting()).toBe(false);

    ptys[0].print('thinking');
    vi.advanceTimersByTime(WAITING_AFTER_MS - 1);
    ptys[0].print('still thinking');
    vi.advanceTimersByTime(WAITING_AFTER_MS - 1);
    expect(waiting()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(waiting()).toBe(true);
    expect(lists.at(-1)?.[0].waiting).toBe(true);

    ptys[0].print('more output');
    expect(waiting()).toBe(false);
    expect(lists.at(-1)?.[0].waiting).toBe(false);
  });

  it('renames an agent with setTitle', async () => {
    const { runtime, lists } = setup();
    const id = await runtime.startAgent(request);

    runtime.setTitle(id, 'Grilling · Password reset');

    expect(runtime.list()[0].title).toBe('Grilling · Password reset');
    expect(lists.at(-1)?.[0].title).toBe('Grilling · Password reset');
  });

  it('runs several agents at once, and stopping one leaves the others running', async () => {
    const { runtime, ptys, output } = setup();
    const first = await runtime.startAgent(request);
    const second = await runtime.startAgent({ ...request, kind: 'research', title: 'Research · Login flow' });
    const third = await runtime.startAgent({ ...request, kind: 'generic', title: 'Customer email' });

    runtime.stop(second);
    ptys[1].print('late output from the stopped agent');
    ptys[1].exit(1);
    ptys[2].print('third still talks');

    expect(new Set([first, second, third]).size).toBe(3);
    expect(ptys.map((pty) => pty.killed)).toEqual([false, true, false]);
    expect(runtime.list().map((agent) => agent.id)).toEqual([first, third]);
    expect(output).toEqual([{ id: third, data: 'third still talks' }]);
  });

  it('drops an agent whose Claude Code ends on its own and reports how it ended', async () => {
    const { runtime, ptys, exits, lists } = setup();
    const id = await runtime.startAgent(request);

    ptys[0].exit(0);

    expect(runtime.list()).toEqual([]);
    expect(lists.at(-1)).toEqual([]);
    expect(exits).toEqual([{ id, exitCode: 0 }]);
  });

  it('stops every agent at once', async () => {
    const { runtime, ptys } = setup();
    await runtime.startAgent(request);
    await runtime.startAgent(request);

    runtime.stopAll();

    expect(ptys.map((pty) => pty.killed)).toEqual([true, true]);
    expect(runtime.list()).toEqual([]);
  });

  it('fails with a clear error, before shipping or spawning anything, when claude is not on PATH', async () => {
    const { runtime, steps } = setup({
      findClaude: () => {
        throw new ClaudeNotFoundError();
      },
    });

    await expect(runtime.startAgent(request)).rejects.toThrow(/Claude Code .*not found.*PATH/);
    expect(steps).toEqual([]);
  });

  it('refuses unknown agent ids, except stop, which does nothing', () => {
    const { runtime } = setup();

    expect(() => runtime.write('no-such-agent', 'x')).toThrow("No agent with id 'no-such-agent'");
    expect(() => runtime.resize('no-such-agent', 80, 24)).toThrow("No agent with id 'no-such-agent'");
    expect(() => runtime.setTitle('no-such-agent', 'x')).toThrow("No agent with id 'no-such-agent'");
    expect(() => runtime.stop('no-such-agent')).not.toThrow();
  });

  it.each([
    ['an unknown kind', { kind: 'wizard' }],
    ['an empty folder', { folder: '' }],
    ['a missing title', { title: undefined }],
    ['a first message that is not text', { firstMessage: null }],
    ['no request at all', null],
  ])('refuses a start request with %s, before spawning anything', async (_name, change) => {
    const { runtime, steps } = setup();
    const bad = change === null ? null : { ...request, ...change };

    await expect(runtime.startAgent(bad as unknown as StartAgentRequest)).rejects.toThrow(
      'Invalid agent start request',
    );
    expect(steps).toEqual([]);
  });

  it('is the terminal runtime, and sends a whole message as typed text, then Enter as a write of its own once the echo is quiet', async () => {
    const { runtime, ptys } = setup();
    const id = await runtime.startAgent({ ...request, firstMessage: '' });
    const pty = ptys[0];

    const sending = runtime.send(id, 'Sample transcript line\nuse it');
    expect(pty.written).toEqual(['Sample transcript line\nuse it']);
    pty.print(`${RULE}\r\n❯ Sample transcript line\r\n  use it`);
    vi.advanceTimersByTime(ENTER_AFTER_QUIET_MS - 1);
    expect(pty.written).toEqual(['Sample transcript line\nuse it']);
    vi.advanceTimersByTime(1);
    await sending;

    expect(runtime.choice).toBe('terminal');
    expect(pty.written).toEqual(['Sample transcript line\nuse it', '\r']);
  });

  it('waits for the whole echo of a long line, however slowly and in however many pieces it comes', async () => {
    const { runtime, ptys } = setup();
    const id = await runtime.startAgent({ ...request, firstMessage: '' });
    const pty = ptys[0];
    // Longer, once redrawn with its line breaks, than the output the runtime scans for a prompt.
    const long = Array.from({ length: 600 }, (_, at) => `word${at}`).join(' ');

    const sending = runtime.send(id, long);
    for (let shown = 200; shown < long.length + 200; shown += 200) {
      vi.advanceTimersByTime(ENTER_AFTER_QUIET_MS / 2);
      pty.print(`\x1b[2K${RULE}\r\n❯ ${long.slice(0, shown).replace(/ /g, '\r\n  ')}`);
    }
    expect(pty.written).toEqual([long]);
    vi.advanceTimersByTime(ENTER_AFTER_QUIET_MS);
    await sending;

    expect(pty.written).toEqual([long, '\r']);
  });

  it('presses Enter on a sent message anyway when its echo never shows, and refuses a send whose agent ends first', async () => {
    const { runtime, ptys } = setup();
    const id = await runtime.startAgent({ ...request, firstMessage: '' });
    const pty = ptys[0];

    const sending = runtime.send(id, 'Sample answer');
    vi.advanceTimersByTime(ECHO_WAIT_MS + ENTER_AFTER_QUIET_MS);
    await sending;
    expect(pty.written).toEqual(['Sample answer', '\r']);

    const lost = runtime.send(id, 'Sample answer two');
    pty.exit(1);
    await expect(lost).rejects.toThrow(`The agent '${id}' has gone`);
    vi.advanceTimersByTime(ECHO_WAIT_MS + ENTER_AFTER_QUIET_MS);
    expect(pty.written).toEqual(['Sample answer', '\r', 'Sample answer two']);
  });

  it('reports an agent ready only once its prompt is up and its first message sent, never during a start-up question', async () => {
    const { runtime, ptys } = setup();
    const id = await runtime.startAgent(request);
    const pty = ptys[0];
    let ready = false;
    void runtime.ready(id).then(() => {
      ready = true;
    });

    pty.print(TRUST_DIALOG);
    await vi.advanceTimersByTimeAsync(ECHO_WAIT_MS);
    expect(ready).toBe(false);

    pty.print(READY_PROMPT);
    pty.print(request.firstMessage);
    await vi.advanceTimersByTimeAsync(ENTER_AFTER_QUIET_MS - 1);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ready).toBe(true);
    expect(pty.written).toEqual([request.firstMessage, '\r']);
  });

  it('reports an agent with no first message ready once its prompt is up', async () => {
    const { runtime, ptys } = setup();
    const id = await runtime.startAgent({ ...request, firstMessage: '' });

    ptys[0].print(READY_PROMPT);

    await expect(runtime.ready(id)).resolves.toBeUndefined();
  });

  it('refuses readiness for an agent that ends before it is ready, and for an unknown agent', async () => {
    const { runtime, ptys } = setup();
    const id = await runtime.startAgent(request);
    const ready = runtime.ready(id);

    ptys[0].exit(1);

    await expect(ready).rejects.toThrow(`The agent '${id}' has gone`);
    await expect(runtime.ready('no-such-agent')).rejects.toThrow("No agent with id 'no-such-agent'");
  });

  it('refuses to send an empty message or to an unknown agent, typing nothing', async () => {
    const { runtime, ptys } = setup();
    const id = await runtime.startAgent({ ...request, firstMessage: '' });

    await expect(runtime.send(id, '')).rejects.toThrow('A message cannot be empty');
    await expect(runtime.send('no-such-agent', 'x')).rejects.toThrow("No agent with id 'no-such-agent'");
    expect(ptys[0].written).toEqual([]);
  });

  it.each([
    [0, 24],
    [80, -1],
    [80.5, 24],
  ])('refuses a terminal size of %s columns by %s rows', async (cols, rows) => {
    const { runtime, ptys } = setup();
    const id = await runtime.startAgent(request);

    expect(() => runtime.resize(id, cols, rows)).toThrow('Invalid terminal size');
    expect(ptys[0].sizes).toEqual([]);
  });
});

describe('findClaude', () => {
  const files = new Set([
    '/usr/local/bin/claude',
    'C:\\Users\\ada\\.local\\bin\\claude.exe',
    'C:\\Users\\ada\\AppData\\Roaming\\npm\\claude.cmd',
  ]);
  const isFile = (path: string) => files.has(path);

  it.each([
    ['on Mac, the first claude on PATH', 'darwin', { PATH: '/usr/bin:/usr/local/bin' }, '/usr/local/bin/claude'],
    [
      'on Windows, claude.exe through PATHEXT, whatever the case of the Path key',
      'win32',
      { Path: 'C:\\Windows;C:\\Users\\ada\\.local\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      'C:\\Users\\ada\\.local\\bin\\claude.exe',
    ],
    [
      'on Windows, an npm-installed claude.cmd',
      'win32',
      { PATH: 'C:\\Users\\ada\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      'C:\\Users\\ada\\AppData\\Roaming\\npm\\claude.cmd',
    ],
  ] as const)('finds %s', (_name, platform, env, expected) => {
    expect(findClaude(env, platform, isFile)).toBe(expected);
  });

  it.each([
    ['PATH lacks it', 'darwin', { PATH: '/usr/bin:/bin' }],
    ['there is no PATH at all', 'linux', {}],
    ['Windows has no matching extension', 'win32', { PATH: 'C:\\Users\\ada\\.local\\bin', PATHEXT: '.BAT' }],
  ] as const)('throws ClaudeNotFoundError when %s', (_name, platform, env) => {
    expect(() => findClaude(env, platform, isFile)).toThrow(ClaudeNotFoundError);
  });
});
