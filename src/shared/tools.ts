/**
 * What Grillo knows about the two tools every member needs (PRD section 1.1, section 4.1 items 2-3):
 * Claude Code (`claude`) and the GitHub command-line tool (`gh`), and who the member is on GitHub.
 * Grillo holds no credentials (PRD section 7): it only reads each tool's own sign-in state.
 */

export type ToolName = 'claude' | 'gh';

/** What the member must do next for one tool: open the install guide, or run the sign-in command. */
export type ToolGuidance = { action: 'install'; url: string } | { action: 'sign-in'; command: string };

export interface ToolStatus {
  installed: boolean;
  signedIn: boolean;
  /** The version the tool reports, such as `2.1.0`; null when not installed or not readable. */
  version: string | null;
  /** Null when the tool is installed and signed in: nothing left to do. */
  guidance: ToolGuidance | null;
}

export type ToolsReport = Record<ToolName, ToolStatus>;

export interface CheckToolsOptions {
  /** Skip the short cache and ask the tools again (the "Check again" button). */
  force?: boolean;
}

/** The member as GitHub knows them. Name and email are null when GitHub does not share them. */
export interface GitHubIdentity {
  login: string;
  name: string | null;
  email: string | null;
}

/** Why the identity could not be read: `gh` missing, signed out, or an answer Grillo could not use. */
export type IdentityFailure = 'not-installed' | 'signed-out' | 'failed';

/** The identity as it crosses IPC: an error class would lose its type on the way to the renderer. */
export type IdentityResult = { ok: true; identity: GitHubIdentity } | { ok: false; reason: IdentityFailure };

declare module './ipc' {
  interface InvokeChannels {
    'tools:check': { request: CheckToolsOptions; response: ToolsReport };
    'tools:identity': { request: void; response: IdentityResult };
  }
}
