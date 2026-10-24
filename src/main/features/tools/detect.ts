import type { CheckToolsOptions, ToolGuidance, ToolName, ToolsReport, ToolStatus } from '../../../shared/tools';
import type { ProcessRunner } from './process-runner';

export const CLAUDE_INSTALL_URL = 'https://code.claude.com/docs/en/setup';
export const GH_INSTALL_URL = 'https://cli.github.com/';
export const CLAUDE_SIGN_IN_COMMAND = 'claude auth login';
export const GH_SIGN_IN_COMMAND = 'gh auth login --web';

/** How long a report is reused before the tools are asked again, unless the caller forces it. */
export const CACHE_MS = 10_000;

const VERSION = /\d+\.\d+\.\d+[^\s()]*/;

interface ToolProbe {
  command: ToolName;
  installUrl: string;
  signInCommand: string;
  isSignedIn(runner: ProcessRunner): Promise<boolean>;
}

/**
 * Claude Code's own status command reads the local sign-in and prints JSON. It starts no session and
 * sends no prompt, so it spends no model usage. Anything but `"loggedIn": true` counts as signed out.
 */
async function claudeSignedIn(runner: ProcessRunner): Promise<boolean> {
  const result = await runner.run('claude', ['auth', 'status', '--json']);
  if (!result.found) return false;
  try {
    const status: unknown = JSON.parse(result.stdout);
    return typeof status === 'object' && status !== null && (status as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
}

const GH_HOST_STATUS = ['auth', 'status', '--hostname', 'github.com'];
/** gh before 2.57.0 has no `--active` flag and stops with this message instead of answering. */
const UNKNOWN_FLAG = /unknown flag/;

/**
 * Only the account Grillo uses: the active one on github.com. A plain `gh auth status` also fails for a
 * stale second account or host, which `gh auth login --web` would not fix. A gh too old for `--active`
 * is asked about github.com alone.
 */
async function ghSignedIn(runner: ProcessRunner): Promise<boolean> {
  let result = await runner.run('gh', [...GH_HOST_STATUS, '--active']);
  if (result.found && result.exitCode !== 0 && UNKNOWN_FLAG.test(result.stderr)) {
    result = await runner.run('gh', GH_HOST_STATUS);
  }
  return result.found && result.exitCode === 0;
}

const PROBES: Record<ToolName, ToolProbe> = {
  claude: {
    command: 'claude',
    installUrl: CLAUDE_INSTALL_URL,
    signInCommand: CLAUDE_SIGN_IN_COMMAND,
    isSignedIn: claudeSignedIn,
  },
  gh: { command: 'gh', installUrl: GH_INSTALL_URL, signInCommand: GH_SIGN_IN_COMMAND, isSignedIn: ghSignedIn },
};

async function probe(runner: ProcessRunner, tool: ToolProbe): Promise<ToolStatus> {
  const versionResult = await runner.run(tool.command, ['--version']);
  if (!versionResult.found) {
    return { installed: false, signedIn: false, version: null, guidance: { action: 'install', url: tool.installUrl } };
  }
  const version = versionResult.exitCode === 0 ? (VERSION.exec(versionResult.stdout)?.[0] ?? null) : null;
  const signedIn = await tool.isSignedIn(runner);
  const guidance: ToolGuidance | null = signedIn ? null : { action: 'sign-in', command: tool.signInCommand };
  return { installed: true, signedIn, version, guidance };
}

export interface ToolChecker {
  checkTools(options?: CheckToolsOptions): Promise<ToolsReport>;
}

export function createToolChecker({
  runner,
  now = Date.now,
}: {
  runner: ProcessRunner;
  now?: () => number;
}): ToolChecker {
  let cached: { at: number; report: Promise<ToolsReport> } | undefined;

  async function check(): Promise<ToolsReport> {
    const [claude, gh] = await Promise.all([probe(runner, PROBES.claude), probe(runner, PROBES.gh)]);
    return { claude, gh };
  }

  return {
    checkTools({ force = false } = {}) {
      if (force || !cached || now() - cached.at >= CACHE_MS) {
        const entry = { at: now(), report: check() };
        cached = entry;
        // A check that failed is never served from the cache.
        entry.report.catch(() => {
          if (cached === entry) cached = undefined;
        });
      }
      return cached.report;
    },
  };
}
