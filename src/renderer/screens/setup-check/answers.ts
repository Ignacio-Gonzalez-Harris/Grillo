/**
 * Reads the answers the setup check gets over IPC. Each answer crosses a process boundary, so its shape is checked
 * here: a malformed answer becomes a `MalformedAnswerError` (or, for the identity, a failed result), never a crash
 * further down while the screen draws.
 */
import type { IdentityFailure, IdentityResult, ToolGuidance, ToolStatus, ToolsReport } from '../../../shared/tools';
import { isSpeechModelUpdates, type SpeechModelUpdates } from '../../../shared/transcription';
import type { UpdatePhase, UpdateState } from '../../../shared/updates';

/** The one error the screen handles for an answer it cannot use. */
export class MalformedAnswerError extends Error {
  constructor(what: string) {
    super(`The setup check got an answer it cannot use: ${what}`);
    this.name = 'MalformedAnswerError';
  }
}

type Fields = Record<string, unknown>;

const WEB_ADDRESS = /^https?:\/\//;
const IDENTITY_FAILURES: readonly IdentityFailure[] = ['not-installed', 'signed-out', 'failed'];
const UPDATE_PHASES: readonly UpdatePhase[] = ['none', 'available', 'downloading', 'ready'];
const LOWEST_PERCENT = 0;
const HIGHEST_PERCENT = 100;

function fieldsOf(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function textOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function readGuidance(value: unknown): ToolGuidance | null {
  if (value === null) return null;
  const fields = fieldsOf(value);
  if (fields?.['action'] === 'install') {
    const url = nonEmptyText(fields['url']);
    if (url && WEB_ADDRESS.test(url)) return { action: 'install', url };
  }
  if (fields?.['action'] === 'sign-in') {
    const command = nonEmptyText(fields['command']);
    if (command) return { action: 'sign-in', command };
  }
  throw new MalformedAnswerError('tool guidance');
}

/** The guidance a status must carry: an install guide when missing, a sign-in command when signed out. */
function expectedAction({ installed, signedIn }: Pick<ToolStatus, 'installed' | 'signedIn'>): ToolGuidance['action'] | null {
  if (!installed) return 'install';
  return signedIn ? null : 'sign-in';
}

function readToolStatus(value: unknown): ToolStatus {
  const fields = fieldsOf(value);
  const installed = fields?.['installed'];
  const signedIn = fields?.['signedIn'];
  if (!fields || typeof installed !== 'boolean' || typeof signedIn !== 'boolean') {
    throw new MalformedAnswerError('tool status');
  }
  const guidance = readGuidance(fields['guidance'] ?? null);
  if ((guidance?.action ?? null) !== expectedAction({ installed, signedIn })) {
    throw new MalformedAnswerError('tool guidance that does not fit its status');
  }
  return { installed, signedIn, version: textOrNull(fields['version']) ?? null, guidance };
}

/** The answer of `tools:check`. */
export function readToolsReport(value: unknown): ToolsReport {
  const fields = fieldsOf(value);
  if (!fields) throw new MalformedAnswerError('tools report');
  return { claude: readToolStatus(fields['claude']), gh: readToolStatus(fields['gh']) };
}

/** The answer of `tools:identity`; anything unusable reads as the `failed` result. */
export function readIdentity(value: unknown): IdentityResult {
  const fields = fieldsOf(value);
  if (fields?.['ok'] === true) {
    const identity = fieldsOf(fields['identity']);
    const login = nonEmptyText(identity?.['login']);
    if (identity && login) {
      return {
        ok: true,
        identity: { login, name: nonEmptyText(identity['name']), email: nonEmptyText(identity['email']) },
      };
    }
  }
  const reason = IDENTITY_FAILURES.find((failure) => failure === fields?.['reason']);
  return { ok: false, reason: fields?.['ok'] === false && reason ? reason : 'failed' };
}

/** The percent of a download, kept between 0 and 100; null when it is not a usable number. */
export function readPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(HIGHEST_PERCENT, Math.max(LOWEST_PERCENT, value));
}

/** The answer of `updates:get-state` (and `updates:set-auto-update`). */
export function readUpdateState(value: unknown): UpdateState {
  const fields = fieldsOf(value);
  const currentVersion = nonEmptyText(fields?.['currentVersion']);
  const phase = UPDATE_PHASES.find((known) => known === fields?.['phase']);
  const autoUpdate = fields?.['autoUpdate'];
  const manualInstall = fields?.['manualInstall'];
  if (!fields || !currentVersion || !phase || typeof autoUpdate !== 'boolean' || typeof manualInstall !== 'boolean') {
    throw new MalformedAnswerError('update state');
  }
  const version = nonEmptyText(fields['version']);
  if (phase !== 'none' && !version) throw new MalformedAnswerError('update offer without a version');
  return {
    currentVersion,
    phase,
    version: phase === 'none' ? null : version,
    percent: readPercent(fields['percent']),
    autoUpdate,
    manualInstall,
  };
}

/** The answer of `transcription:get-model-updates`. */
export function readSpeechModelUpdates(value: unknown): SpeechModelUpdates {
  if (!isSpeechModelUpdates(value)) throw new MalformedAnswerError('speech model update mode');
  return value;
}

/** The version an update event names; null when it names none. */
export function readEventVersion(payload: unknown): string | null {
  return nonEmptyText(fieldsOf(payload)?.['version']);
}
