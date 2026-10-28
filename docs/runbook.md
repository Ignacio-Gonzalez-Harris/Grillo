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
  `mount(el, params, shell)`; no shared file changes. It may also export `start(shell)`, run once when the shell
  starts (for work that outlives the screen; it may return a cleanup function), and `shell.onAgentTabs(listener)`
  tells it the agent tabs now and after every change, once each tab's header slot (`shell.agentTabHeader(id)`)
  exists. Every colour and spacing value is a `var(--...)` token from
  `src/renderer/theme/tokens.css`, an exact copy of the UX prototype's token file: the token lint test fails on a
  literal value, and on a copy that differs from the prototype.

## Setup

Grillo opens on the setup check. It checks the two tools every member needs and reads who the member is on GitHub.
It holds no credentials: it only asks each tool about its own sign-in.

### The setup check screen

- **Three rows:** Claude Code, the GitHub command-line tool (gh) and your GitHub account. Each shows "Checking…"
  first, then green when it is ready.
- **A tool not found** shows the install steps and "Open install guide", which opens the guide in your browser.
- **A tool signed out** shows the exact sign-in command to run in a terminal, such as `gh auth login --web`.
- **"Check again"** asks the tools afresh (it skips the 10-second cache) once you have installed or signed in.
- **Your GitHub account** shows your login, name and email once gh is signed in. No email means gh may not read it
  yet: the row shows `gh auth refresh -h github.com -s user:email`; run it once, then press "Check again".
- **Continue** opens the Project screen. It unlocks when every row is green; a missing email does not lock it.
- **The update card** appears below the rows once the first check has finished. It always holds the two update
  settings: the app updates switch ("Install automatically on the next restart") and speech model updates
  (Automatic, Ask or Never). Both are saved at once in the app data folder's `settings.json`, by the updates and
  transcription features.
- **When a newer Grillo is offered**, the card says which version and which you have, with "Download and install"
  and "Later". While it downloads it shows the percent; once downloaded the button reads "Restart and install".
  "Later" hides the offer until Grillo offers it again.
- **On a Mac that cannot install updates itself** (an unsigned build), "Download and install" opens the latest
  release page on GitHub instead: download the new version there and drag it into Applications.

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

The project screens arrive with their own stories. What already works underneath them, through `gh` and `git`:

- **Before anything works:** `gh` is signed in, `git` is installed, and `git` can push to GitHub as you
  (`gh auth setup-git` once, plus `git config --global user.name` and `user.email`). Without that, a save stops
  with the error `git` printed.
- **The project folder** is `~/Grillo/<owner>/<repo>`: cloned with `gh repo clone` the first time, brought up to
  date with `git pull --ff-only` after that. Every agent runs there. If it holds changes that are not on GitHub,
  opening the project stops and lists them; Grillo never resets or deletes them. Save or discard them yourself.
- **A new project** is a new private repository in the organisation you pick, tagged with the topic
  `grillo-created`, with Grillo's labels and a `.grillo/` folder (`members.json`, `structure.json`) on main.
- **Connecting an existing repository** needs write access and issues turned on. A repository that already
  holds a Grillo project opens that project. An empty repository (no commits yet) works too: Grillo's first
  save makes its first commit. With write access only, inviting, removing people, closing and reopening are
  refused with the reason: GitHub keeps those for repository admins.
- **Invitations** are GitHub repository invitations: an admin in a repository Grillo created, write access in
  a connected one. Pending invitations to you are listed and accepted inside Grillo.
- **Saves** go through the project folder: commit, then push to main. If someone pushed first, Grillo pulls and
  saves again, renumbering a new source or PRD version to the next free number. If main is protected, Grillo
  pushes a `grillo/save-<time>` branch and opens a pull request instead; main changes once someone merges it.
- **Closing a project** archives its repository (admins only): everything stays readable and every change is
  refused until someone reopens it.
- **The project list** is the recent projects on this laptop (opened before), minus any whose repository is gone.

## Map and tickets

The map and ticket screens arrive with their own stories. What already works underneath them, through `gh`:

- **The map** is one issue titled "Map" with the label `wayfinder:map`. Its body holds five sections: destination,
  notes, settled (one line per closed ticket), fog and out of scope.
- **A ticket** is an issue with exactly one kind label (`wayfinder:grilling`, `research`, `prototype` or `task`),
  linked as a native sub-issue of the map. Its questions are numbered `Q<issue number>.<k>`; a removed question
  keeps its line as "(removed)", so a number is never used twice.
- **Tags** are `domain:<name>` labels, and only a domain some member declared can be set. "No domain" is the label
  `domain:none`; it never sits beside another domain label. Grillo leaves every other label on the issue alone.
- **Blockers** are written twice and kept in step: a "Blocked by" section in the body and GitHub's own "blocked by"
  link between issues.
- **Taking a ticket** assigns you, then reads the assignees again. If someone else was assigned at the same moment,
  whoever was assigned first keeps it; the other is unassigned again and told who has it. Only people who accepted
  their invitation to the repository can take a ticket or be sent one: GitHub ignores anyone else.
- **Answers, discussions and decisions** are comments on the ticket that start with a hidden marker line
  (`<!-- grillo:answer -->` and so on) and a few header lines. Change them in Grillo, not on GitHub: a comment
  whose header lines were edited by hand makes that ticket unreadable, and also makes the ticket list refuse for
  the whole project, because the list reads every ticket's comments. The same goes for a ticket whose body
  sections or kind labels were edited by hand. Put the header, body or label back on GitHub to recover.
- **Answering from a phone or browser:** any comment without a marker waits in the ticket's pick-up list until an
  answer is made from it. Deleting that answer puts the comment back and the question reads unanswered again.
- **Closing** closes the issue as completed. **Merging** writes the decision "Merged into #<other>" and closes the
  issue as a duplicate of the other ticket. **Reopening** takes the ticket's line off the map's settled list.
  After a close or a merge Grillo reports whether the map is done: no open ticket and no fog left.
- **A closed (archived) project** can still be read; every change to the map or a ticket is refused.
- Issues without Grillo's labels, and pull requests, are ignored.

## Agents

Each agent shows in its own tab: click the agent's name on the tab bar.

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

### The agent tab

- **The tab shows the agent's own Claude Code terminal** (release 1; the chat view comes in release 2). It fills
  the window and follows its size.
- **Typing is always available.** Click into the terminal and type, exactly as in a normal terminal (arrow keys,
  Esc and Enter included). Or use the box under it ("Type to the agent…"): Enter or Send types the line into the
  agent, then presses Enter. Send on an empty box presses Enter alone.
- **Nothing is lost when you switch tabs.** An agent keeps its terminal from the moment its tab appears: what it
  prints while you are on another tab, and any half-typed text in the box, are still there when you come back.
- **When an agent stops**, its tab goes away. Opening it from an old link says "This agent is not running."
- **Developers: tab panels.** A story adds to the agent tab with a file `src/renderer/screens/<name>/tab-panel.ts`
  that exports as `default` one panel or an array of panels, each `{ kinds, slot, priority, mount }`: `kinds` is
  `'all'` or a list of agent kinds; `slot` is `body` (the main view: only the highest priority shows; the built-in
  terminal has priority 0), `controls` (a column beside the body, as on the meeting screen) or `header` (inside the
  agent's tab on the tab bar, beside its name and dot, such as the Channel switch); higher priority comes first.
  `mount(el, context)` runs once per agent when its tab appears and may return `shown()` (each time the tab is
  opened), `dispose()` (when the agent stops) and, for a body, `setInput(text)`. `context.setInput(text)` puts text
  into the type box. A malformed `tab-panel.ts`, or two body panels tied for one kind, stops Grillo at start with
  the folder named; a panel that throws is logged and the rest of the tab still works.

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

### Audio capture

The meeting screen's record button arrives with its own story; the capture underneath it works on its own.

- **What is captured:** the room microphone (Windows and Mac), or the call audio, meaning whatever the speakers play
  (Windows only). Audio becomes 5-second slices of 16 kHz mono 16-bit sound, the format the speech model reads,
  and stays on the laptop. Stopping a capture sends what is left as one last, shorter slice.
- **Mac call audio is not available yet.** Choosing it on a Mac says so; record the room microphone instead.
- **Microphone permission:** a Mac asks the first time Grillo records. If it was refused, Grillo says where to
  turn it on: System Settings > Privacy & Security > Microphone, then restart Grillo. On Windows a switched-off
  microphone is reported the same way: Settings > Privacy & security > Microphone, with "Let desktop apps access
  your microphone" on.
- **Picking a microphone:** Grillo lists the computer's microphones and keeps the one picked as `audioInputDevice`
  in the app data folder's `settings.json`; with none picked it uses the system default. If the picked microphone
  is unplugged, recording says so instead of silently using another one.
- **Call audio on Windows** needs no permission and shows no picker; it captures every sound the computer plays,
  including notification sounds.

## Grilling engine

The grilling engine is the skill `grillo-wayfinder`, shipped into the project folder with the other Grillo skills.
The screen that starts it arrives with the project creation story; until then a developer can run it by hand.

- **What it does:** `/grillo-wayfinder .grillo/sources/S1.md` reads the idea from that source file and, with no
  questions asked, creates the map issue (destination always "A PRD for ..."), the tickets with their numbered
  questions (`Q<ticket>.<k>`), the fog and the out-of-scope lines. Tickets start with no domain: run the tagging
  round next.
- **Every PRD structure section is covered:** at the start of every session, a section of `.grillo/structure.json`
  with no settled decision, no open ticket and no fog line gets a ticket or a fog line. A ticket's "Why it matters"
  and a fog line start with the section's name and ": ", which is how the engine tells sections apart.
- **Recording an answer** always runs in this order: the contradiction check (the agent re-reads the map and the
  related tickets; on a clash it asks you follow-up questions and records nothing until you settle it), then the
  source file `.grillo/sources/S<n>.md` pushed to `main`, then the answer comment.
- **Taking a ticket:** the agent assigns you, re-reads the assignees, and backs off when someone else was assigned
  first.
- **The map-done rule:** after every ticket the agent closes or merges, it re-reads the map; with no open ticket and no
  fog left it says the map is done and starts `/grillo-prd`.
- **Release 1 runs grilling agents only.** Research, prototype and task tickets are created, and you work them as
  grilling (tell the agent what you found, built or saw) until release 3.
- **Run it by hand (developers):** in a clone of a made-up test project with `.grillo/sources/S1.md` and
  `.grillo/structure.json` on `main`, copy `resources/skills/grillo-wayfinder/` into `.claude/skills/`, start
  `claude` there and type `/grillo-wayfinder .grillo/sources/S1.md`. Never use a real transcript or customer text.
- **Developers:** `npx vitest run resources/skills/grillo-wayfinder` checks the skill's frontmatter and command
  against the catalogue, every record format it teaches against the store's own parsers and
  `docs/store-layout.md`, and its fixture of a session's output with `resources/skills/fixture-check.ts`, the checker
  other skills' tests reuse for their own fixtures.

## Own-time answering

Nothing to do yet: own-time answering arrives with its own story.

## PRD

The PRD writer is the skill `grillo-prd`, shipped into the project folder beside `grillo-wayfinder`. The PRD view
(screen 8) and its export arrive with their own story; until then the versions are files you open in the repository.

- **When it runs:** by itself the moment the map is done (no open ticket, no fog): the agent that closed the last
  ticket starts `/grillo-prd`. `/grillo-prd regenerate` writes a new version on demand, in the current PRD structure,
  even while other tickets are open; their answers stay out until they close.
- **What it writes:** the next version `.grillo/prd/v<n>.md` on `main`, numbered and dated. An earlier version is
  never changed; when another laptop saves a version at the same moment, yours takes the next number and both are
  kept.
- **Codes:** every statement ends with the codes of the answers it rests on, `[S4, Q12.3]` (source 4, question 3 of
  ticket 12), or `[no source]` when no answer supports it. The audit appendix at the end lists every cited source and
  question with who, when, where and the exact words, then every `[no source]` statement under Unsourced.
- **A PRD section with no decision is not written:** the writer opens a ticket or a fog line for it, writes no
  version, and says the map is not done. The PRD is written when that ticket or fog line is settled.
- **Feedback:** `/grillo-prd feedback` asks what is wrong, one point at a time. Wording fixes and removing a
  `[no source]` statement become one new version. Confirming a `[no source]` statement or changing a decision opens
  a ticket (`Confirm: ...` or `Revisit: ...`); when those close, the PRD is written again as a new version.
- **Run it by hand (developers):** in a clone of a made-up test project whose map is done, copy
  `resources/skills/grillo-prd/` and `resources/skills/grillo-wayfinder/` into `.claude/skills/`, start `claude`
  there and type `/grillo-prd`. Never use a real transcript or customer text.
- **Developers:** `npx vitest run resources/skills/grillo-prd` checks the skill's frontmatter and commands against
  the catalogue, the version format it teaches, and its fixture of a project after one round of feedback with
  `resources/skills/grillo-prd/prd-check.ts`: version numbers, codes on every statement, sections resting on
  decisions, and an appendix listing every cited code word for word.

## Updates

The update card on the setup screen arrives with that screen's story. Underneath it, Grillo already looks for a newer
version on its GitHub Releases page when it starts and then every hour while it is open. It never shows a pop-up
window of its own: the setup screen draws the offer.

- **Download and install** downloads the new version, then closes Grillo, installs it and opens it again.
- **Later** hides that version until Grillo starts again; a newer version is still offered.
- **App updates switch** (`autoUpdate` in the app data folder's `settings.json`, off by default): when on, Grillo
  downloads a new version quietly and installs it the next time Grillo closes.
- **On a Mac, Grillo installs updates itself only once the app is signed.** Until then the update state carries
  `manualInstall: true`, so the card explains how to install the new version by hand from the Releases page. The
  release job that signs the Mac app builds with `MAIN_VITE_MAC_SIGNED=true`.
- A failed check (no network, no release yet) is only written to the log; the member sees nothing and the next hourly
  check tries again.
- Developers: `npm run dev` never checks for updates; the log says "Update check skipped: this is a development run".

## Store

Grillo reads and writes its data through one store. Which one is picked when the app starts:

1. GitHub (the default): `npm run dev` with `GRILLO_STORE` unset. Until the two GitHub backend stories land,
   every store call answers "not implemented yet".
2. Made-up data in memory: set `GRILLO_STORE=memory` in the shell, then `npm run dev`. Nothing reaches
   GitHub, and the data is gone when the app closes, except the recent-projects list in the settings file.

With any other value of `GRILLO_STORE` the app opens no window, and the terminal names the two allowed
values. How the data lives in GitHub is pinned in `docs/store-layout.md`.

## Releases and download site

Installers are built only when a version is published; the download site is published from `main`.

- **Publishing a version.** Set `version` in `package.json` on `main`, then publish a GitHub release whose tag is
  that version with a leading `v` (for example `v1.0.0`). The `release` workflow then runs the full gate and
  `npm run dist` on a Windows and a Mac runner, and attaches the installers, `latest.yml`, `latest-mac.yml` and
  their blockmaps to the release (installed apps read those to offer the update). A tag that does not match the
  version fails the run before anything is built. The pilot installers are unsigned.
- **Trying it first on a draft release** (nothing is offered to installed apps until it is published):
  1. Create a draft release with the tag `v<version from package.json>`; do not publish it.
  2. Under Actions, run the `release` workflow by hand from `main`, giving that tag.
  3. Check that both runs pass and that the draft now lists the `.exe`, `.dmg`, `.zip`, both `latest*.yml` files
     and the blockmaps; then publish the draft or delete it.
- **The download site** is the static page in `site/`. The `pages` workflow publishes it on every push to `main`,
  but only once Pages is switched on; until then its runs are skipped, not failed. To switch it on:
  1. Settings, Pages: set the source to "GitHub Actions".
  2. Settings, Secrets and variables, Actions, Variables: add the repository variable `PAGES_ENABLED` = `true`.
  3. Under Actions, run the `pages` workflow by hand once (or push to `main`).

  The page asks GitHub for the latest release when it opens and points the download buttons at its installers;
  without an answer they open the releases page.
- **Once the installers are signed**, set `data-installers="signed"` on the `<html>` element of `site/index.html`:
  the unsigned-installer warning and the "Run anyway" and "Open Anyway" steps disappear.
- Open `site/index.html` from disk to check its look; the latest-release lookup only runs when it is served.
