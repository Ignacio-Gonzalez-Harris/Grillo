import { describe, expect, it } from 'vitest';
import { CLAUDE_INSTALL_URL, CLAUDE_SIGN_IN_COMMAND, createToolChecker, GH_INSTALL_URL, GH_SIGN_IN_COMMAND } from './detect';
import { createFakeRunner, exited, type FakeAnswers, NOT_FOUND } from './fake-runner';

const CLAUDE_SIGNED_IN = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'ada@example.test' });
const CLAUDE_SIGNED_OUT = JSON.stringify({ loggedIn: false, authMethod: 'none' });

const READY: FakeAnswers = {
  'claude --version': exited(0, '2.1.0 (Claude Code)\n'),
  'claude auth status --json': exited(0, CLAUDE_SIGNED_IN),
  'gh --version': exited(0, 'gh version 2.60.1 (2024-10-01)\nhttps://github.com/cli/cli/releases/tag/v2.60.1\n'),
  'gh auth status --active --hostname github.com': exited(0, '', 'github.com\n  Logged in to github.com account ada-example (keyring)\n'),
};

function checker(answers: FakeAnswers, clock = { now: 0 }) {
  const runner = createFakeRunner(answers);
  return { runner, clock, tools: createToolChecker({ runner, now: () => clock.now }) };
}

describe('checkTools', () => {
  it('reports both tools installed, signed in and at their versions, with nothing left to do', async () => {
    const { tools } = checker(READY);

    await expect(tools.checkTools()).resolves.toEqual({
      claude: { installed: true, signedIn: true, version: '2.1.0', guidance: null },
      gh: { installed: true, signedIn: true, version: '2.60.1', guidance: null },
    });
  });

  it('points to the exact install guide for a tool that is not installed, without asking it about sign-in', async () => {
    const { tools, runner } = checker({ 'claude --version': NOT_FOUND, 'gh --version': NOT_FOUND });

    await expect(tools.checkTools()).resolves.toEqual({
      claude: { installed: false, signedIn: false, version: null, guidance: { action: 'install', url: CLAUDE_INSTALL_URL } },
      gh: { installed: false, signedIn: false, version: null, guidance: { action: 'install', url: GH_INSTALL_URL } },
    });
    expect(CLAUDE_INSTALL_URL).toBe('https://code.claude.com/docs/en/setup');
    expect(GH_INSTALL_URL).toBe('https://cli.github.com/');
    expect(runner.calls).toEqual(['claude --version', 'gh --version']);
  });

  it('gives the exact sign-in command for a tool that is installed but signed out', async () => {
    const { tools } = checker({
      ...READY,
      'claude auth status --json': exited(1, CLAUDE_SIGNED_OUT),
      'gh auth status --active --hostname github.com': exited(1, '', 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n'),
    });

    const report = await tools.checkTools();

    expect(report.claude).toEqual({
      installed: true,
      signedIn: false,
      version: '2.1.0',
      guidance: { action: 'sign-in', command: CLAUDE_SIGN_IN_COMMAND },
    });
    expect(report.gh).toEqual({
      installed: true,
      signedIn: false,
      version: '2.60.1',
      guidance: { action: 'sign-in', command: GH_SIGN_IN_COMMAND },
    });
    expect(CLAUDE_SIGN_IN_COMMAND).toBe('claude auth login');
    expect(GH_SIGN_IN_COMMAND).toBe('gh auth login --web');
  });

  it('treats any Claude Code status answer it cannot read as signed out, never as an error', async () => {
    const unreadable = ['', 'not json', 'null', '[]', '"loggedIn"', '{}', '{"loggedIn":"true"}', '{"loggedIn":null}'];

    for (const stdout of unreadable) {
      const { tools } = checker({ ...READY, 'claude auth status --json': exited(0, stdout) });
      const report = await tools.checkTools();
      expect(report.claude, `status output ${JSON.stringify(stdout)}`).toMatchObject({
        installed: true,
        signedIn: false,
        guidance: { action: 'sign-in', command: CLAUDE_SIGN_IN_COMMAND },
      });
    }
  });

  it('keeps a tool installed with no version when its version answer is unreadable or it stopped', async () => {
    const { tools } = checker({
      ...READY,
      'claude --version': exited(0, 'Claude Code\n'),
      'gh --version': { found: true, exitCode: null, stdout: '', stderr: '' },
    });

    const report = await tools.checkTools();

    expect(report.claude).toMatchObject({ installed: true, version: null });
    expect(report.gh).toMatchObject({ installed: true, version: null });
  });

  it('asks Claude Code only for its version and its own sign-in status, so no model usage is spent', async () => {
    const { tools, runner } = checker(READY);

    await tools.checkTools();

    expect(runner.calls.filter((line) => line.startsWith('claude '))).toEqual([
      'claude --version',
      'claude auth status --json',
    ]);
  });

  it('answers from a 10-second cache, and asks the tools again after it or when forced', async () => {
    const { tools, runner, clock } = checker(READY);
    const runs = () => runner.calls.filter((line) => line === 'gh --version').length;

    await tools.checkTools();
    clock.now = 9_999;
    await tools.checkTools();
    expect(runs()).toBe(1);

    await tools.checkTools({ force: true });
    expect(runs()).toBe(2);

    clock.now = 9_999 + 10_000;
    await tools.checkTools();
    expect(runs()).toBe(3);
  });
});
