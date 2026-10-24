# Grillo run-book

How to use each part of Grillo, one section per feature. Each feature's story edits only its own section.

## App shell

Every screen sits in one window: the title bar ("Grillo" and where you are), the tab bar, and the screen below it.

- **The tab bar**, left to right: Setup and Project; then Map, Tickets and PRD; then one tab per running agent;
  then "+". Grillo opens on Setup. A screen whose own story has not landed yet says "<name> is not built yet."
- **Agent tabs** are named "kind · ticket" (for example "Grilling · Sample ticket 1") and follow the agent when it
  renames itself. An orange dot on a tab means that agent is waiting for you. Click the name to open the agent.
- **"+"** opens the generic agent tab.
- **Windows fallback.** The panels are frosted glass. Where the blur is unavailable, or the system asks for less
  transparency (on Windows: Settings, Personalisation, Colours, Transparency effects off), they turn nearly opaque so
  text stays readable. To preview it, open the developer tools console and run
  `document.body.classList.add('no-glass')`.
- **Developers.** A new screen is a new folder `src/renderer/screens/<name>/index.ts` exporting `id`, `title` and
  `mount(el, params, shell)`; no shared file changes. Every colour and spacing value is a `var(--...)` token from
  `src/renderer/theme/tokens.css`, an exact copy of the UX prototype's token file: the token lint test fails on a
  literal value, and on a copy that differs from the prototype.

## Setup

The setup screen arrives with its own story. Underneath it, Grillo already checks the two tools every member needs
and reads who the member is on GitHub. It holds no credentials: it only asks each tool about its own sign-in.

### How Grillo checks the tools

| Tool | Installed when | Signed in when | What Grillo tells the member when it is missing |
|---|---|---|---|
| Claude Code | `claude --version` runs | `claude auth status --json` prints `"loggedIn": true` | Install: <https://code.claude.com/docs/en/setup>. Sign in: `claude auth login` |
| GitHub command-line tool | `gh --version` runs | `gh auth status --hostname github.com --active` exits with 0 (only the account Grillo uses); a gh older than 2.57.0, which lacks `--active`, is asked `gh auth status --hostname github.com` | Install: <https://cli.github.com/>. Sign in: `gh auth login --web` |

- **No model usage is spent.** `claude auth status` reads Claude Code's own local sign-in and prints it; it starts no
  session and sends no prompt. Grillo never reads the credentials file or the keychain itself.
- Any status answer Grillo cannot read counts as signed out, so the member sees the sign-in command.
- Grillo looks for each tool on the PATH first, then in the folders installers use even when the PATH does not list
  them yet: `~/.local/bin` on every system; `/opt/homebrew/bin` and `/usr/local/bin` on a Mac; the GitHub CLI and
  WinGet folders on Windows. So a tool installed while Grillo is open is found by "Check again", without a restart.
- A tool that does not answer within 15 seconds is stopped and reported without a version.
- Results are kept for 10 seconds; "Check again" asks the tools afresh.

### Who the member is on GitHub

Grillo reads the login, name and email with `gh api user`. When the profile keeps the email private, Grillo asks
`gh api user/emails` for the primary address. That second call needs the read-only `user:email` scope (permission), which a plain
`gh auth login` does not grant, so the email then stays empty. To show it, run `gh auth refresh -h github.com -s user:email`.
A signed-out `gh` is reported as signed out, never as an error.

## Projects

Nothing to do yet: project creation and invitations arrive with their own story.

## Map and tickets

Nothing to do yet: the map and its tickets arrive with their own story.

## Agents

The agent runtime is in place; the tab that shows an agent's terminal arrives with its own story.

- **Claude Code must be installed and on PATH.** Each agent is your own `claude`, started with no extra flags
  in the project folder. Without it, starting an agent fails with "Claude Code was not found: there is no
  `claude` command on PATH".
- **Answer Claude Code's own startup questions yourself.** The first time it opens a folder it asks whether
  you trust it. Grillo waits; it types the agent's first message, then Enter, only once the message box appears.
- **Grillo's skills are copied in on every start.** Every `grillo-*` skill goes into the project folder's
  `.claude/skills/`, so updates arrive. A copy the project's repository tracks is never overwritten: Grillo
  skips it and logs a warning. The copied folders are listed in `.git/info/exclude`, so they never show as
  changes. Grillo writes no `CLAUDE.md`; your own user-level `CLAUDE.md` still applies.
- **Several agents run at once**; stopping one leaves the others running. Closing Grillo stops them all.
- **The waiting dot:** an agent counts as waiting for you once it has printed nothing for 3 seconds after
  printing something, and stops waiting as soon as it prints again.

## Meeting

The meeting screen arrives with its own story. What already works underneath it:

### Speech model (local transcription)

- Speech turns into text on the host's laptop with whisper.cpp and its `base.en` model; no audio or text leaves the
  machine for transcription.
- The model (about 148 MB) is downloaded once, on first use, from its public home on Hugging Face into the app data
  folder: `%APPDATA%\Grillo\models\ggml-base.en.bin` on Windows, `~/Library/Application Support/Grillo/models/` on
  a Mac. Its size and SHA-256 checksum are checked; a damaged or cut-short file is downloaded again.
- Model updates follow the `speechModelUpdates` value in the app data folder's `settings.json`: `automatic` (download
  a newer model straight away), `ask` (the default: ask first) or `never` (no check at all, not even a network call).
  The toggle for it arrives with the setup check screen.
- Developers: the real-transcription smoke test (`*.model.test.ts`) joins `npm test` only on a machine where that
  model file exists; delete the file to leave it out again.

## Own-time answering

Nothing to do yet: own-time answering arrives with its own story.

## PRD

Nothing to do yet: the PRD view arrives with its own story.

## Updates

Nothing to do yet: app updates arrive with their own story.

## Store

Grillo reads and writes its data through one store. Which one is picked when the app starts:

1. GitHub (the default): `npm run dev` with `GRILLO_STORE` unset. Until the two GitHub backend stories land,
   every store call answers "not implemented yet".
2. Made-up data in memory: set `GRILLO_STORE=memory` in the shell, then `npm run dev`. Nothing reaches
   GitHub, and the data is gone when the app closes, except the recent-projects list in the settings file.

With any other value of `GRILLO_STORE` the app opens no window, and the terminal names the two allowed
values. How the data lives in GitHub is pinned in `docs/store-layout.md`.
