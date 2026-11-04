# Grillo run-book

How to use each part of Grillo, one section per feature. Each feature's story edits only its own section.

## App shell

Every screen sits in one window: the title bar ("Grillo", where you are and the project you are in), the tab bar,
and the screen below it.

- **The tab bar**, left to right: Project; then Map, Tickets and PRD; then one tab per running agent; then "+"; and
  Setup at the far right. With many agent tabs the tabs scroll sideways, but Setup stays where it is, always in reach.
  A screen whose own story has not landed yet says "<name> is not built yet."
- **Which screen Grillo opens on** is explained under Setup, Where Grillo opens, below.
- **The current project** is the one you opened last in this window: opening a project (from the Project tab, a
  link such as Open the map, or a meeting agent's tab) makes it current. The title bar names it (`<owner>/<repo>`),
  and Map, Tickets, PRD and "+" open on it, so with two projects open you never see one project's map, tickets or
  PRD while working in the other. Setup and the Project tab stand outside any project and show none, and so does
  an agent's tab, unless it says which project it works for (a meeting agent's tab does). Before you
  have opened a project, Map, Tickets and PRD fall back to the project opened last on this laptop.
- **Agent tabs** are named "kind · ticket" (for example "Grilling · Sample ticket 1") and follow the agent when it
  renames itself. A meeting agent's tab is named after the ticket it is grilling (see The meeting panel, below). An orange dot on a tab means that agent is waiting for you. Click the name to open the agent. Keyboard focus stays on an agent tab or its Channel switch when agents start or stop.
- **"+"** opens the generic agent tab.
- **The window frame is Grillo's own.** There is no separate system title bar: drag Grillo's title bar (the strip
  with the logo and "Grillo") to move the window, and double-click it to maximise or restore. The system window
  buttons sit inside that title bar: minimise, maximise and close at the top right on Windows (hover over maximise
  for the snap layouts), the red, yellow and green buttons at the top left on Mac. Drag any window edge to resize.
- **Windows fallback.** The panels are frosted glass. Where the blur is unavailable, or the system asks for less
  transparency (on Windows: Settings, Personalisation, Colours, Transparency effects off), they turn nearly opaque so
  text stays readable. To preview it, open the developer tools console and run
  `document.body.classList.add('no-glass')`.
- **On a Mac, opened from the Dock or Finder.** Grillo finds Claude Code, `gh`, `git` and `node` exactly as your
  Terminal does, wherever they came from (the Claude Code installer's `~/.local/bin`, Homebrew, nvm, volta or fnm).
  At start-up it asks your login shell (the one in `SHELL`, or `/bin/zsh` when that is unset) for its PATH once, and
  every tool and agent Grillo starts uses it. A shell that fails, prints something unreadable or takes more than
  5 seconds is skipped: Grillo opens anyway with the short system PATH and logs one warning starting "Grillo kept
  the PATH it was started with". If tools are then missing, check that a new Terminal window starts quickly and
  without errors. Windows needs none of this: it already passes your PATH to Grillo.
- **When Grillo cannot start**, it shows the reason in the system's error dialog, titled "Grillo could not start"
  (for example "Feature 'agents' could not start: …"), and closes once you press OK. No Grillo process is left
  running in the background. Start Grillo again; if the same message comes back, pass it on to whoever supports you.
- **Developers.** A new screen is a new folder `src/renderer/screens/<name>/index.ts` exporting `id`, `title` and
  `mount(el, params, shell)`; no shared file changes. It may also export `start(shell)`, run once when the shell
  starts (for work that outlives the screen; it may return a cleanup function), and `shell.onAgentTabs(listener)`
  tells it the agent tabs now and after every change, once each tab's header slot (`shell.agentTabHeader(id)`)
  exists. Every colour and spacing value is a `var(--...)` token from
  `src/renderer/theme/tokens.css`, an exact copy of the UX prototype's token file: the token lint test fails on a
  literal value, and on a copy that differs from the prototype.

## Setup

The first time, Grillo opens on the setup check. It checks the two tools every member needs and reads who the member
is on GitHub. It holds no credentials: it only asks each tool about its own sign-in.

### Where Grillo opens

- **First launch:** the setup check. Pressing Continue with everything green stores `setupFinished` in the app data
  folder's `settings.json`. A setting that cannot be read, or holds anything but `true`, counts as a first launch, and
  so does the first start of a member who used Grillo before this setting existed.
- **Every later start** runs the same checks while the screen says "Checking your setup…". Everything passing opens
  Project. Anything failing opens the setup check, which shows what is wrong; that includes a check that itself fails.
  The setting stays stored, so the next passing start opens Project again.
- **A tab you press while the check runs** stays open: the check's answer does not move you.
- **To see the setup check again**, press Setup at the far right of the tab bar. It behaves as on a first launch.
- **To start over as a first launch**, close Grillo and delete `setupFinished` from `settings.json`.

### The setup check screen

- **Three rows:** Claude Code, the GitHub command-line tool (gh) and your GitHub account. Each shows "Checking…"
  first, then green when it is ready.
- **A tool not found** shows the install steps and "Open install guide", which opens the guide in your browser.
- **A tool signed out** shows the exact sign-in command to run in a terminal, such as `gh auth login --web`.
- **"Check again"** asks the tools afresh (it skips the 10-second cache) once you have installed or signed in.
- **Your GitHub account** shows your login, name and email once gh is signed in. No email means gh may not read it
  yet: the row shows `gh auth refresh -h github.com -s user:email`; run it once in a terminal, approve it in your
  browser, then press "Check again" and Grillo reads your email again. Sign-in itself stays `gh auth login --web`.
- **Continue** opens the Project screen and remembers that setup is finished (see Where Grillo opens). It unlocks when
  every row is green; a missing email does not lock it.
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
- **A new project** is a new repository under the owner you pick, tagged with the topic `grillo-created`, with
  Grillo's labels and a `.grillo/` folder (`members.json`, `structure.json`) on main. In an organisation it is always
  private. Under your own GitHub account it is private unless you choose public.
- **Connecting an existing repository** needs write access and issues turned on. A repository that already
  holds a Grillo project opens that project. An empty repository (no commits yet) works too: Grillo's first
  save makes its first commit. With write access only, inviting, removing people, closing and reopening are
  refused with the reason: GitHub keeps those for repository admins.
- **Invitations** are GitHub repository invitations: an admin in a repository Grillo created in an organisation,
  write access in a connected one. A repository under a personal account has only its owner and collaborators, so
  only the owner can invite, close and reopen; a collaborator sees those greyed out with the reason. Pending
  invitations to you are listed and accepted inside Grillo.
- **A public project exposes its data:** anyone can read its transcripts, answers and PRD. Anyone can also comment on
  it, so Grillo counts only comments from the repository's owner, a collaborator, or an organisation member listed in
  `.grillo/members.json`. Others, an organisation member with no place in the project included, are never answers,
  discussions, decisions or comments waiting to be picked up. Agents read comments through `gh`, with commands that
  leave those comments out, so their text does not reach the model; an agent that runs a command of its own, or text a
  member pastes, can still bring an outsider's words in (PRD section 8, Risks). Once GitHub
  stops calling someone who left a public project a collaborator, their comments stop counting and the questions they
  answered read as open again.
- **Saves** go through the project folder: commit, then push to main. If someone pushed first, Grillo pulls and
  saves again, renumbering a new source or PRD version to the next free number. If main is protected, Grillo
  pushes a `grillo/save-<time>` branch and opens a pull request instead; main changes once someone merges it.
- **Closing a project** archives its repository (admins only): everything stays readable and every change is
  refused until someone reopens it.
- **The project list** is the recent projects on this laptop (opened before), minus any whose repository is gone.

### The project screen

The Project tab. It opens on **Your projects** (the projects opened on this laptop, last opened first, each with
Open), the two ways in, **New project** and **Connect existing**, and **Pending invitations** (each with Accept).

- **Accept** takes the GitHub repository invite in one click, then asks for your role (free text) and domains,
  pre-filled from the last project you joined. "Save and open the project" saves them and opens the map.
- **New project** and **Connect existing** walk the same four steps, one topic per page, each saying which step of
  four it is. Back keeps everything typed, and Cancel goes back to Your projects. Next is stopped only by that step's
  own problem, with the reason beside the control that caused it; the reason goes as soon as the control changes.
  1. **Where.** New project: a project name (it suggests the repository name), the owner (the GitHub organisations
     your sign-in belongs to and your own account; an organisation first, your own account when you have none) and
     the repository name. For your own account, Private (the default) or Public; choosing Public warns that
     transcripts, answers and the PRD are visible to anyone. Connect existing: your repositories are listed with your
     access to each. Search narrows the list; pick one. Read access only says it cannot be connected. Picking a public
     repository shows the same warning; it can still be connected. "Check access"
     asks GitHub again, and also checks a repository typed in full as `owner/repository` that the list does not hold.
     The switch at the top changes between the two ways in and keeps what was typed for each.
  2. **Structure.** "Start from" Grillo's default of 13 sections or an earlier project's structure, then move
     sections up or down, rename them, change their notes, remove them or add new ones. When connecting, it is
     folded until you press Edit, and it opens by itself if a section needs fixing.
  3. **People.** Type a GitHub login and press Invite; invites are sent when the project is created. Set your own
     role and domains (pre-filled from the last project you joined). When connecting with write access only, inviting
     is greyed out with the reason; admin access allows it.
  4. **Idea.** Write or paste text, with documents attached (text files), or paste or upload a transcript.
- **The review page** lists each step's answers, with Change going back to that step and "Back to review" returning.
  It repeats the Public warning, for a new repository or a connected one, says when your access is read only, and says when a login or a domain was typed but
  never added, because neither stops the project and neither is kept. Nothing is created until you press the button
  at the bottom.
- **Create project** (or "Connect and start") lists each step as it runs: the repository with Grillo's labels and
  folder, your role and domains, the invites, the idea saved as source S1 (attached documents as S2, S3, …), then a
  grilling agent started in the project folder with `/grillo-wayfinder .grillo/sources/S1.md`. A failed step shows
  its reason; "Try again" carries on from that step. If GitHub refuses the new repository, "Back to Where" changes
  the answers that caused it, with the others kept. Then open the map or the grilling agent.
- **A grilling agent that was refused** can be started again later, also after leaving this screen or closing Grillo:
  press Open on the project under Your projects (it is listed even if its folder never opened, as "created <date>").
  It shows the failed start with its reason, "Try again" and "Open the map"; once the agent has started, or the
  project has a map, Open goes to the map as usual. The refusals are kept in the app data folder's `settings.json`
  under `unstartedGrillingAgents`.
- **A repository that already holds a Grillo project** is not connected twice: "Open it" opens that project. One
  that cannot be connected (issues turned off, read access only) says why, with "Check again". Both offer "Pick
  another repository", which goes back to Where with every answer kept.
- **Editing the structure later.** The PRD view's "Edit structure and regenerate" opens this screen with the
  project (`{ project: '<owner>/<repo>' }`): edit the sections, then "Save and regenerate" saves
  `.grillo/structure.json` and starts a grilling agent with `/grillo-prd regenerate`; Cancel goes back unsaved.
- **Your last role and domains** are kept in the app data folder's `settings.json` under `lastMembership`.

## Map and tickets

The map and ticket screens arrive with their own stories. What already works underneath them, through `gh`:

- **The map** is one issue titled "Map" with the label `wayfinder:map`. Its body holds five sections: destination,
  notes, settled (one line per ticket, with its latest decision's gist), fog and out of scope. A ticket closed as out
  of scope shows only under Out of scope, even if it carried a decision. If two laptops change the map at the same
  moment Grillo writes its change again on the fresh map; if that keeps failing it says the map keeps changing, and
  trying again in a moment works.
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
  issue as a duplicate of the other ticket. **Reopening** takes the ticket's lines off the map's settled and
  out-of-scope lists. After a close or a merge Grillo reports whether the map is done: no open ticket and no fog left.
  A store change of the map that takes the last fog line off reports the same; no control on the map screen does that
  today, so fog still goes through an agent, which applies the map-done rule itself.
- **When adding a ticket or merging fails halfway** (a dropped connection), the error shows: do the same thing again
  with the same words. Grillo finishes the same ticket, with all its links, instead of making a second one.
- **A closed (archived) project** can still be read; every change to the map or a ticket is refused.
- Issues without Grillo's labels, and pull requests, are ignored.

### The map screen

The Map tab shows where the project stands. It opens the current project (see App shell, above), or else the
project you opened last on this laptop; with neither it says to open a project from the Project tab.

- **The four map cards:** the destination, settled (one line per closed ticket: its title and the decision's gist),
  fog and out of scope.
- **While the engine builds the map** (no map yet, or a map with no ticket yet) the screen says so, and the tickets
  appear as they are created. The screen reads GitHub again whenever an agent goes quiet (its tab's dot) or stops.
- **The ticket list** shows every open ticket with its kind, domain tags (or "untagged", or "no domain"), who holds
  it ("Locked") and the tickets it waits for. "My domains first" puts your own tickets, those of your domains and the
  "no domain" ones first; "All" keeps issue order.
- **Run tagging round** opens a grilling agent in its own tab that types `/grillo-tagging`; the tags appear when it
  goes quiet. It is the main action until the first round has tagged a ticket.
- **Add ticket** asks for a title, a kind, the question, why it matters and the questions, one per line (none: the
  question itself is the only one). **Edit** changes the title, kind, question and why it matters.
- **Merge** and **Close as out of scope** show only on tickets nobody holds. Merge closes the ticket as a duplicate
  of the open ticket you pick. Close as out of scope writes a line under Out of scope, `<title>: <why> (#<number>)`,
  then closes the ticket with no decision.
- **Map done:** when a close or merge from this screen leaves no open ticket and no fog, Grillo starts the PRD writer
  (a grilling agent typing `/grillo-prd`) and says so, with buttons to open it and the PRD tab.
- **Sources** lists every source with its code, kind, who, the day and where; **Open** shows its full text.
- **Close project** archives the repository; the map then shows "archived", greys out every change, and **Reopen**
  unarchives it. Both need repository admin rights; without them the button is greyed out with the reason.

### The tickets screen

The Tickets tab is where you work through tickets one by one. It opens the same project the Map tab would, and the
ticket it was opened for, or else the first ticket of your list. With no ticket yet it says the grilling agent has not
built the map.

- **Your list** comes in groups: taken by you or sent to you, then your domains (tickets nobody holds in one of your
  domains, or tagged "no domain"), then everything else (held by someone else, shown with their login, in other
  domains, or not tagged yet), then the closed ones. Every row shows its kind badge (grilling, research, prototype or
  task) beside the title; a damaged ticket's row says only "Damaged". Nothing is hidden. **Search** keeps the tickets whose title or
  questions contain what you type.
- **The open ticket** shows its kind and who holds it: "Not assigned", "Assigned to you", or "Locked · assigned to
  <login>". A locked ticket greys out Take and says who holds it; you can still read it.
- **Take** assigns the ticket to you, and **Send** to the member you pick. If someone else took it on another laptop
  first, the refusal shows and the ticket shows as locked to them. **Release** (on your own ticket) puts it back in
  the pool, unlocked. **Reassign** moves a held ticket to any member until it has an answer.
- **Domains:** remove a tag with its ×, or add one from "Add a domain…" (the members' declared domains, and "no
  domain", which replaces every other tag). Every change here is a change by hand: it also writes the tags-by-hand
  comment, so no later tagging round changes those tags. Removing the last domain leaves "no domain"; removing "no
  domain" leaves the ticket untagged, deletes its tags-by-hand comments and hands it back to the next tagging round.
- **Questions** show Open or Answered. An answer shows its text, who recorded it and when, and its source codes; an
  answer made from a GitHub comment shows "Source: <who>, via GitHub, <date> · recorded by <login>". **Undo** deletes
  a recorded answer, so the question is open again (and a GitHub comment waits to be picked up again).
- **Show discussion (word for word)** shows each recorded discussion of the ticket in full.
- **Edit**, **Merge** and **Close as out of scope** work as on the map, on tickets nobody else holds. When a merge or
  close leaves no open ticket and no fog, Grillo starts the PRD writer (`/grillo-prd`) and says so.
- **Answer now** opens the own-time screen on the ticket; a ticket someone else holds has none, since only they answer it.
- **Pick up GitHub comments** shows while members' plain comments on open tickets wait to be recorded. It opens a
  grilling agent in its own tab that types `/grillo-answer pickup`; the answers appear when the agent goes quiet.
- **Launch research agent**, **Launch prototype agent** or **Launch task agent** (release 3) sits first on an open
  research, prototype or task ticket, with a line saying the command it runs. It opens an agent of that kind in a tab
  named "<Kind> · <ticket title>" that types `/grillo-research <n>`, `/grillo-prototype <n>` or `/grillo-task <n>`,
  and shows that tab. A grilling ticket has no launch control. The control is greyed out, saying why, while that
  ticket's tab still runs or while any member (you included) holds the ticket: release it first to launch it.
- **An archived project** stays readable here, with every change control gone.

## Agents

Each agent shows in its own tab: click the agent's name on the tab bar.

- **Two runtimes, one choice: terminal (the default) or chat.** Every agent tab is a **terminal agent** by default:
  the release-1 plain terminal, where you type into the tab and answer clickable options and permission prompts
  yourself. It stays the default, even with the chat view in place, until the terms check confirms that Anthropic
  allows the machine-readable mode with members' own subscriptions (PRD section 8, Agent runtime). The **chat view
  is opt-in**: set the environment variable `GRILLO_AGENT_RUNTIME=chat` before starting Grillo, and every agent tab
  is a **chat agent**: your own `claude` in machine-readable mode (see Agent chat protocol below), exactly one Claude
  Code process per tab, whose id is the tab's id, shown in the **chat view** (see below).
  (`GRILLO_AGENT_RUNTIME=terminal`, or leaving it unset, gives the terminal.) Any other value keeps the terminal and
  logs a warning naming the variable. The choice applies to every agent tab until Grillo restarts.
- **Messages from the screens are one chat message each.** The meeting's "use it", own-time's "use it" and Done,
  and the meeting's control lines (`session:`, `mode:`, `present:`, `skip`, `jump`) each reach a chat agent as one
  message. With the Open channel on, the live transcript goes into the chat view's message box; how Use it and the
  other control lines send that box is under Chat view, Open channel, below.
- **Claude Code must be installed and on PATH.** Each agent is your own `claude`, started in the project folder
  (a terminal agent with no extra flags). Without it, starting an agent fails with "Claude Code was not found:
  there is no `claude` command on PATH".
- **Answer Claude Code's own startup questions yourself** (terminal agents only). The first time it opens a folder it asks whether
  you trust it. Grillo waits; it types the agent's first message once the message box appears, and presses Enter only
  once Claude Code shows the typed message (or after 10 seconds without it), so the message is sent on its own even
  when Claude Code is slow right after you answer the trust question.
- **Grillo's skills are copied in on every start.** Every `grillo-*` skill goes into the project folder's
  `.claude/skills/`, so updates arrive; Grillo's own test files and test data stay behind. A copy the project's repository tracks is never overwritten: Grillo
  skips it and logs a warning. The copied folders are listed in `.git/info/exclude`, so they never show as
  changes. Grillo writes no `CLAUDE.md`; your own user-level `CLAUDE.md` still applies.
- **Several agents run at once**; stopping one leaves the others running. Closing Grillo stops them all.
- **The waiting dot:** a chat agent counts as waiting for you once its turn ends or it asks a question or a
  permission, and stops waiting when it starts a turn, says something or is sent a message. Answering, allowing or
  denying takes the dot off at once (unless another question or permission still waits), and so does Claude Code
  withdrawing the question; a tool that runs, or the agent thinking, after its turn ended counts as work too. A terminal agent counts
  as waiting once it has printed nothing for 3 seconds after printing something, and stops waiting as soon as it
  prints again.

### The agent tab

- **A terminal agent's tab** (the default) shows the agent's own Claude Code terminal, which fills the window and
  follows its size. **A chat agent's tab** (`GRILLO_AGENT_RUNTIME=chat`) shows the chat view (see Chat view below).
- **Around the terminal or chat** a tab may show parts above it and in columns on either side (the meeting and own-time
  screens, the relayed note); a tab with nothing to show there gives the room to the terminal or chat.
- **Typing in a terminal agent's tab is always available.** Click into the terminal and type, exactly as in a
  normal terminal (arrow keys, Esc and Enter included). Or use the box under it ("Type to the agent…"): Enter or
  Send types the line into the agent, then presses Enter. Send on an empty box presses Enter alone.
- **Nothing is lost when you switch tabs.** An agent keeps its chat or terminal from the moment its tab appears:
  what it says while you are on another tab, and any half-typed text in the box, are still there when you come back.
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

### Chat view (release 2)

The body of every chat agent's tab (opt-in: `GRILLO_AGENT_RUNTIME=chat`, see Agents above): the meeting, own-time
answering, the generic agent, the support agent and every launched agent then all show their agent as a chat. Every
label is in English.

- **The head** names the agent ("Grilling agent · Sample ticket 4"), shows "Channel open · receiving the transcript
  live" while the tab's Open channel is on, and carries the **Show terminal** switch.
- **Bubbles:** what the agent says on the left, what was written to it on the right as "You": your own messages,
  the first message the agent was started with, the meeting's and own-time's messages, and relays from the Support
  agent. Nothing is lost: a tab shows its agent's messages from the very first one, even those sent before the tab
  appeared.
- **Clickable options:** a question shows one button per option, with its description. One click answers a
  single question. "Something else" lets you type your own answer in the message box; Send then answers with it
  (transcript words the box holds go with that answer and are no longer held). A prompt with several questions, or
  one that takes several picks, is answered with **Send answers** once each question has a pick (several picks go as
  one answer, joined with commas). While an answer is on its way, its buttons are greyed out; once answered, they
  stay greyed out and your pick stays highlighted.
- **Permission prompts** ("Asks permission") show the tool and what it would run, with **Allow** and **Deny**. A
  question or prompt Claude Code repeats is shown, and answered, once.
- **Withdrawn questions:** when Claude Code withdraws a question or permission prompt before you answer it, its
  buttons disappear and "The agent withdrew this question." (or "this request.") shows in their place. A
  "Something else" answer you had started for it is dropped: the next Send is a plain message.
- **When Claude Code fails:** if the agent's Claude Code ends with an error (it could not start, or stopped with
  an exit code other than 0), the chat shows a red note with the exit code and the last 10 lines of Claude Code's
  own error text (for example a flag it does not know). The tab then closes, and the same note stays under "This
  agent is not running." while you are on that tab.
- **The message box:** Enter or Send writes one chat message to the agent. A message that cannot be sent, an answer
  that is refused, an error the agent reports, a turn that ends in error, or a message Grillo cannot read shows as a
  red note in the chat; the agent carries on.
- **Show terminal** reveals the agent's raw event stream (one JSON line per event, as Claude Code printed it) under
  the chat, read-only: a chat agent has no terminal to type into. Questions and permission prompts are highlighted,
  prompts written into the agent and tool results have colours of their own. Only the newest 2000 lines are kept,
  on screen as in memory.
- **Open channel:** while the session holds live transcript words for the agent, they are added to the end of the
  message box as they are spoken, and "Channel open · receiving the transcript live" shows in the head only while
  the channel is open. On a grilling agent the line "Use it sends what the message box shows, your edits included,
  as one message…" shows under the box; other agents have no Use it, so they show no such line. The box stays yours
  on every agent tab: edit it and press **Send** to send all of it as one message, and the words it showed are no
  longer held (words spoken since stay held for the next message). On the meeting's grilling agent, **Use it** (or
  any other meeting control: skip, jump, Listen or Type, presence) sends exactly what the box shows, your edits
  included, with the control line on its own last line, as one chat message; then the box is empty and none of
  those words are held any more. Words spoken after your last edit are added to the box and go with it. Line breaks
  between transcript slices show as spaces in the one-line box and are sent as line breaks. On other agents, which
  have no Use it, a meeting message (the session line) takes only the held words, and they leave the box; what you
  typed yourself stays. Closing the channel or ending the session keeps any held words in the box, ready to send
  or delete.

### Agent chat protocol (release 2)

The chat view's engine, and what every agent tab runs on under the chat runtime. Its `agent-chat:*` channels take a
tab's id, since the tab and its chat agent share it; stop a tab with `agents:stop` or `agent-chat:stop`, and either
takes it off the tab bar (`agent-chat:stop` reports the end on `agent-chat:exited` with no exit code). While a chat agent's Open channel holds transcript words, main sends them on `session:held` (`''` once sent);
`session:sendBox` sends the message box with the held words it showed, so they are never sent twice;
`session:editBox` keeps a grilling agent's box as the member edits it, so a meeting control sends what the box shows
(`session:held` then carries `sent: true` and the view empties the box); `session:releaseHeld` forgets the box when
an answer took it.

- **A chat agent is your own `claude` with no terminal**, started in the project folder with fixed flags:
  `claude -p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio
  --permission-mode manual`. Never `--bare`, so your user-level `CLAUDE.md` and your subscription login still
  apply. Grillo's skills are copied in first, as for every agent, so the folder must be a git clone.
- **What comes back** on `agent-chat:message`: `init` (each turn), `assistant` (text bubbles), `user` (every
  message Grillo wrote in, first message and relays included), `question` (clickable options), `permission` (a
  tool waiting for Allow or Deny), `result` (turn end), `answered` (an answer, allow or deny went to Claude Code:
  the agent works on), `cancelled` (Claude Code withdrew that question or permission, matched by its request id),
  `working` (a tool event or thinking after the agent waited), `failed` (Claude Code ended with an error: the exit
  code and the last lines of its stderr) and `error` (a line it could not read; the agent carries on). A withdrawal
  for a request Claude Code never sent, or one with no id, is an `error`; one for a request already answered is
  ignored. Every raw line also goes out on `agent-chat:raw`, for the "show terminal" switch.
- **Answering:** `agent-chat:answer` with the question's id and the chosen label (or free text; with several
  questions, question text to answer), `agent-chat:allow` and `agent-chat:deny` with the permission's id. Deny also
  dismisses a question. Each id is answered once; a second answer, an unknown id or an empty answer comes back as
  `{ ok: false, reason }`, never as an exception.
- **The relay:** `agent-chat:relay` with the target agent, the member and the text writes one message
  `[from Support, for <member>] <text>` into the target's chat; its reply arrives in the target's own stream.
  Square brackets in the name become round ones and line breaks become spaces, so the prefix stays one line.
- **A question Claude Code sends that Grillo cannot read** is answered with an error at once, so the agent never
  hangs waiting, and shows as an `error` message.

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
  (Windows, and a Mac with macOS 14.2 or later). Audio becomes 5-second slices of 16 kHz mono 16-bit sound, the
  format the speech model reads, and stays on the laptop. Stopping a capture sends what is left as one last,
  shorter slice.
- **Mac call audio** has its own subsection below.
- **Microphone permission:** a Mac asks the first time Grillo records. If it was refused, Grillo says where to
  turn it on: System Settings > Privacy & Security > Microphone, then restart Grillo. On Windows a switched-off
  microphone is reported the same way: Settings > Privacy & security > Microphone, with "Let desktop apps access
  your microphone" on.
- **Picking a microphone:** Grillo lists the computer's microphones and keeps the one picked as `audioInputDevice`
  in the app data folder's `settings.json`; with none picked it uses the system default. If the picked microphone
  is unplugged, recording says so instead of silently using another one.
- **Call audio on Windows** needs no permission and shows no picker; it captures every sound the computer plays,
  including notification sounds.

### Mac call audio

- **Needs macOS 14.2 or later.** On an older Mac, choosing call audio says macOS 14.2 is needed; record the room
  microphone instead. Like Windows, it shows no picker and captures every sound the Mac plays.
- **Permission:** the Mac does not report a missing permission, it just gives silence. So Grillo waits up to
  2 seconds for the first sound frame; if none arrives (or the Mac refused the capture), it records nothing and
  says where to grant it: System Settings > Privacy & Security > Screen & System Audio Recording, turn on Grillo,
  then restart Grillo.
- **If the Mac has no call audio to give** (no audio track at all), Grillo says so; record the room microphone.
- **Not yet tried on a real Mac.** Whether macOS also asks for Screen Recording, and the exact name of the
  settings pane, are still to be confirmed by the first Mac run.

### Grilling session

The meeting panel's controls arrive with their own story; the session logic underneath them works on its own.

- **Starting** a session creates its file in the project's Grillo folder, `.grillo/sessions/<date>-<time>.md`, named
  by the moment it started (UTC). Only one session runs on a laptop at a time.
- **Presence** is the list of members ticked present; each change replaces the list in the file. A login that is
  not a member is refused and the list stays as it was.
- **Consent:** Record stays disabled until the host, the member signed in on this laptop, ticks "everyone here
  agreed". The file records who ticked and when; a second tick changes nothing.
- **Recording** turns every 5-second slice into one line of the transcript, in the order spoken, and writes the
  whole transcript to the file as it grows. Silence (`[BLANK_AUDIO]`) adds nothing. A slice that fails to
  transcribe, or takes more than 15 seconds once the speech model starts on it, is left out and the stream goes on.
  Switching the recording off returns once the file holds every slice heard; if that last write fails, the host
  is told and the text is kept for the next try. Switching it on again carries on in the same file.
- **Open channel** on an agent writes each new line into that agent's input box without sending it. "Use it",
  Listen / Type, skip and jump each send one message: the protocol line on a line of its own under the transcript
  (`resources/skills/README.md`). While an agent is in Type mode no transcript goes into its box. An agent whose
  channel opens during a session is first told the session file. Several channels can be open at once; an agent
  that has stopped simply loses its channel.

### Meeting grilling skill

The agent that runs a live session is the skill `grillo-meeting`, shipped into the project folder with the other
Grillo skills. Grillo types `/grillo-meeting` when the host starts a live session; the meeting panel's controls then
drive it by typing the protocol messages (`resources/skills/README.md`).

- **Which ticket comes next:** the open ticket with the lowest number whose blockers are all closed and whose domains
  match someone ticked present. "No domain", and a ticket not tagged yet, count as everyone's. Tickets of absent
  domains stay on the map. A presence change applies from the next ticket; with nobody present the agent waits.
- **Questions one at a time.** **Type:** the next message a member types is the answer, with no discussion.
  **Listen:** the room talks; at "Use it" the agent writes the answer from the transcript and keeps the whole talk,
  word for word, as the question's discussion, which names the session file.
- **Every answer's source** is a meeting source: the session file, the moment of "Use it" or of typing, and the
  members present. Before the session is started, a "Use it" chunk is recorded as pasted text instead.
- **Skip** leaves the question open and asks the next; after the last one the ticket is left as Done leaves it.
  **Jump** leaves the ticket at hand and takes the one picked, whatever its domains; a closed ticket or one someone
  else holds is refused. **Done** closes the ticket with its decision when every question is answered (and starts
  the PRD writer once the map is done), or else releases it with its open questions. Talk above Skip, Jump or Done
  is never recorded. A ticket left with questions open is not picked again in the same session by any of its
  grilling agents: the agent marks it with the folder `meeting-holds/<session id>/left/<ticket number>` inside
  `.git` before letting go of it. Jump still takes it.
- **Several grilling agents in one session** all act for the host's login, so before claiming a ticket each one
  holds it in the session: it makes the folder `meeting-holds/<session id>/<ticket number>` inside the project
  folder's `.git` (never committed), which only one agent can make, and writes its tab's id (Grillo starts every
  agent with `GRILLO_AGENT_ID`) into the folder's `tab` file, so the host's screen names the tab after it. A ticket another agent of the session holds is
  skipped (or a jump to it is refused); the agent removes its hold when it leaves the ticket. When a tab stops
  mid-ticket (closed, ended on its own, or stopped as Grillo quits), Grillo removes every hold whose `tab` file names
  that tab, so the other agents can take the ticket at once.
- **The question at hand:** just before each question the agent writes `<n> of <m>` into the `question` file of its
  hold folder, and the host's question card shows it (see The meeting panel, below). The agent's only message to a
  screen is that file (`resources/skills/README.md`, Agent-to-screen protocol).
- **Drift:** what else the room says may add a question to the ticket, a new ticket (with no domain until the next
  tagging round), a fog line or an out-of-scope line. The agent says what it added.
- **Run it by hand (developers):** in a clone of a made-up test project with a map and tagged tickets on `main`, copy
  `resources/skills/grillo-wayfinder/` and `resources/skills/grillo-meeting/` into `.claude/skills/`, start `claude`
  there and type `/grillo-meeting`, then the messages one at a time: `present: <your login>`, `mode: type`, an
  answer, `done`. Never use a real transcript.
- **Developers:** `npx vitest run resources/skills/grillo-meeting` checks the skill's frontmatter and command against
  the catalogue, that it follows exactly the protocol messages the catalogue gives it, its example records against
  the store's parsers, and two fixtures (a project before and after a live session) against the store layout and the
  rules of a session.

### Starting a meeting

The host starts a live session from the **Map** tab: **Start meeting** sits in the Tickets card's header, beside Add
ticket and Run tagging round.

- **Pressing it** starts a grilling agent in the project folder that types `/grillo-meeting`, named "Grilling · Live
  session", and opens its tab, where the meeting panel shows (below).
- **One meeting agent at a time:** while this project's meeting agent is running, Start meeting opens its tab
  instead of starting a second one. Once that agent has stopped, it starts a new one.
- **Another project's meeting running:** the laptop runs one live session at a time, so while another project's
  meeting agent runs, Start meeting opens nothing and starts nothing. A note under the Tickets header says "A live
  session of `<owner>/<repo>` is running on this laptop, and Grillo runs one live session at a time. To start one
  for this project, end that session first: type /exit in each of its grilling agent tabs, or quit Grillo."
  **Open that session** opens that meeting's tab, whose title bar names its project. Agent tabs have no close
  control: typing `/exit` in a terminal agent's tab (the default runtime) ends its Claude Code and the tab goes away,
  and the session ends with its last meeting agent. Quitting Grillo stops every agent, whatever the runtime.
- **A closed (archived) project** shows no Start meeting button; Reopen brings it back.
- **While the engine builds the map** the Tickets card has no header row, so there is no Start meeting either.
- **Developers:** `npx vitest run src/renderer/screens/map/map.test.ts -t "starting a live meeting"` runs the button
  against the real agent runtime, live session and meeting panel, with fake terminals and the in-memory store.

### The meeting panel

The meeting screen sits on a meeting agent's own tab (a grilling agent started with `/grillo-meeting`); there is no
separate session screen. **Start meeting** on the Map tab starts one (see Starting a meeting, above).

- **Opening the tab** starts the live session for the project if none is running, ticks the host present, and once
  the agent has gone quiet after starting types `session: <session file>`, `present: <host>` and `mode: type` into
  it, so every answer it records cites the session, channel open or not.
- **Present:** one tick per member, with their domains and a Host badge on the member signed in. Each tick is
  written to the session file and typed into the agent as a new `present:` message.
- **Preparing speech model:** before the first recording on a laptop the speech model downloads, with its progress.
  Record stays off until it is ready; a failed download says why and offers "Try again". Type answers work meanwhile.
- **Consent:** the line to read aloud (on a public project it also says the transcript is public), then "Everyone
  here agreed". Record stays disabled until the host ticks it;
  the card then says who ticked and when.
- **Record** captures the source chosen above it (see Recording source, below) and shows the red Recording banner with the
  time since Record went on. Switching it off saves the transcript file and goes back to Type. If the microphone
  cannot be opened, the recording turns back off and the reason shows. The session has one microphone: every
  grilling agent's tab shows the same Record switch, and turning it off in any tab stops the capture, even one
  started in a tab whose agent has since stopped.
- **The question card**, above the terminal, names the ticket the agent holds, its domain tags and "Question 2 of 3",
  once the agent has gone quiet after asking. With no ticket held the row stays away; an agent that has not said which
  question it asks shows the ticket and tags with no count. The question's own words stay in the terminal or chat.
- **Listen / Type** per question; Listen needs the recording on and opens this agent's channel. **Use it** (Listen
  only) sends the transcript in the agent's box with `use it`. **Skip question** and **Jump to ticket** type `skip` and
  `jump <number>`. **Import a transcript** pastes or uploads a text file and sends it with `use it`.
- **The transcript strip** under the terminal shows each transcribed line with the time it appeared.
- **Channel**, the switch inside every agent's tab, opens or closes that agent's channel; while open, the live
  transcript goes into its type box. It can be turned on before any session runs: the agent is then told the
  session file when one starts.
- **Grilling agents** (shown once consent is ticked) lists the session's grilling agents by tab name, this tab's agent
  highlighted, each with "Channel open" or "Channel closed"; one opened from here carries a New badge until its
  channel opens. **Open another grilling agent** starts one more grilling agent with `/grillo-meeting` in the same
  session and opens its tab: it is told the same session file, who is present and `mode: type`, and starts with its
  channel closed. Each agent receives the transcript only while its own Channel switch is on, and each takes a
  different ticket (see Meeting grilling skill, above). If the agent cannot start, the reason shows and you stay on
  this tab.
- **The tab's name** follows the ticket the agent holds: "Grilling · Live session" until it takes one, then
  "Grilling · <ticket title>" once it goes quiet after taking it (for example "Grilling · Sample ticket 3"), renamed
  each time it moves to another ticket (Done, Skip past the last question, Jump), and back to "Grilling · Live
  session" while it holds none. The Grilling agents card lists the same names. A ticket added during the meeting is
  read afresh, and appears under Jump to ticket too.
- **The title bar** names the meeting's project while its tab is open, and Map, Tickets and PRD then open on it.
- **Stopping the last meeting agent** ends the session, its transcript saved; while another one runs, the session
  goes on and the stopped one leaves the list.
- **Developers:** `npx vitest run src/renderer/screens/meeting src/main/features/session` runs the panel against the
  real session, agent runtime and in-memory store, with fake terminals, a fake transcriber and no microphone.

### Recording source

- **Where:** the Recording card of the meeting panel, above Record: **Room microphone** (the people in this room) or
  **Call audio** (the virtual meeting's sound playing on this laptop). Room microphone is the default.
- **Record** starts the capture of the chosen source (see Audio capture and Mac call audio, above). On a Mac, call
  audio goes through the same permission check as before; if it is missing, the recording turns back off and the
  reason shows, with no extra screen.
- **Locked while recording:** both choices are greyed out and the card says "Turn Record off to change the source."
  Turn Record off, pick the other source, and turn Record on again.
- **One choice for the session:** every grilling agent's tab shows the same choice, as it shows the same Record switch.

### When spoken words could be lost

- **Microphone unplugged, or call audio no longer shared:** the recording stops by itself, Record turns off, the red
  banner goes, and the meeting panel says why in red. Everything heard before that is kept in the transcript; nothing
  said after it is recorded. Listen falls back to Type. Plug the microphone back in (or pick the other source), then
  turn Record on again; the session goes on in the same file.
- **Transcription behind:** when more than two slices wait for the speech model (a busy laptop can take longer than
  a slice lasts), a yellow line above the transcript strip says how many and about how many seconds of talk. Their
  words come late; a slice the model takes more than 15 seconds over is still left out (see the next point), and the
  panel does not count those. The line goes once the model catches up.
- **A slow slice:** each slice gets 15 seconds from the moment the speech model starts on it. Slices queued behind a
  slow one keep their full time, and a slice the model never answers is left out alone; the ones behind it go on.
  The model works on one slice at a time and cannot stop one midway, so a slice left out keeps working in the
  background on its own copy of the model while the next slices go to a fresh copy (loaded again, about 150 MB more
  memory until the left-out slice finishes; for one that never finishes, until Grillo is closed).
- **Agents not ready yet:** nothing (the session file, presence, mode, transcript) is typed into a grilling agent
  until Claude Code shows its prompt and has taken its first message, so a start-up question (such as "trust this
  folder?") is never answered by Grillo. Answer it in the agent's tab; the session catches up then.
- **Sending a message to a terminal agent** waits until Claude Code has shown the whole message and gone quiet before
  pressing Enter, so a long message is never left unsent in the input box. If the message never shows, Enter is
  pressed anyway after 10 seconds.

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
- **Taking a ticket:** the agent first holds it on this laptop, then assigns you, re-reads the assignees, and backs
  off when someone else was assigned first. The hold is the folder `meeting-holds/no-session/<ticket number>` inside
  the project folder's `.git` (never committed), with the tab's id in its `tab` file: several grilling agents on one
  laptop all act for your login, so a ticket assigned to you may be another agent's, and only the agent that made the
  folder takes it. The others take the next ticket on the frontier. The agent removes the folder when it closes,
  merges or releases the ticket, or finds it is another login's (the answer, research, prototype and task agents
  too, at Done); Grillo removes it when the tab stops. If Grillo itself crashed while an agent held a
  ticket, that ticket stays held on this laptop: delete `.git/meeting-holds/` in the project folder while no agent runs
  there.
- **The map-done rule:** after every ticket the agent closes or merges, it re-reads the map; with no open ticket and no
  fog left it says the map is done and starts `/grillo-prd` itself, in the same agent.
- **Release 1 runs grilling agents only.** Research, prototype and task tickets are created, and you work them as
  grilling (tell the agent what you found, built or saw) until release 3.
- **Run it by hand (developers):** in a clone of a made-up test project with `.grillo/sources/S1.md` and
  `.grillo/structure.json` on `main`, copy `resources/skills/grillo-wayfinder/` into `.claude/skills/`, start
  `claude` there and type `/grillo-wayfinder .grillo/sources/S1.md`. Never use a real transcript or customer text.
- **Developers:** `npx vitest run resources/skills/grillo-wayfinder` checks the skill's frontmatter and command
  against the catalogue, every record format it teaches against the store's own parsers and
  `docs/store-layout.md`, and its fixture of a session's output with `resources/skills/fixture-check.ts`, the checker
  other skills' tests reuse for their own fixtures.

## Tagging round

The tagging round is the skill `grillo-tagging`, shipped into the project folder with the other Grillo skills. The
"Run tagging round" button on the map screen arrives with that screen's story; until then a developer can run it by
hand.

- **What it does:** `/grillo-tagging` reads the domains every member declared in `.grillo/members.json` and gives
  every open ticket one or more of them as `domain:<name>` labels, creating any label that is missing. A ticket that
  fits nobody gets `domain:none`, the visible "no domain" tag: anyone may answer it. Closed tickets and every label
  that does not start with `domain:` are left alone; nothing else on the ticket changes.
- **Run it again as members join:** each round looks at every open ticket afresh against the domains declared now,
  so a new member's domain can replace "no domain", and a domain nobody declares any more is taken off.
- **Tags you set by hand stay yours:** a ticket with a comment that starts with the hidden line
  `<!-- grillo:tags-by-hand -->` (header lines `who:`, `when:`, `domains:`) keeps its domain labels in every later
  round. Change the tags on the tickets screen, or ask the tagging agent to set them by hand, and both write the
  labels and that comment.
  Changing the labels only in GitHub's own label menu writes no such comment, so the next round may change them back.
  **Undo:** delete the ticket's tags-by-hand comments and the next round tags it again.
- **Run it by hand (developers):** in a clone of a made-up test project with a map, tickets and
  `.grillo/members.json` on `main`, copy `resources/skills/grillo-tagging/` into `.claude/skills/`, start `claude`
  there and type `/grillo-tagging`.
- **Developers:** `npx vitest run resources/skills/grillo-tagging` checks the skill's frontmatter and command against
  the catalogue, the labels and the tags-by-hand marker it teaches against `docs/store-layout.md` and the store's own
  parser, and three fixtures (before the first round, after it, and after a member joined and the round ran again)
  against the store layout and the rules of a round.

## Own-time answering

Answer a ticket on your own, with a grilling agent or in a form, then press **Done**. The screen opens on one ticket
(the Tickets screen's "Answer now" opens it when that screen lands); a ticket in the pool is taken for you as it
opens. A closed ticket, or one someone else holds, is shown with the reason and is left as it is.

- **In a form:** type under a question and press **Save answer**. Your words are saved word for word as an
  own-time source (`S<n>`, "Grillo, own-time form on ticket #<n>"), then as the answer citing it, and the question
  turns "Answered". **Edit** changes an answer the same way: the new answer is saved first, then the old one is
  deleted. A save that fails says why and keeps what you typed.
- **With a grilling agent:** starts `/grillo-answer <ticket>` in the project folder and opens its tab: the ticket's
  heading above the terminal, the questions with their answered state in the column on its right. They refresh when the agent goes
  quiet and when you come back to the tab. Pressing it again opens the agent already answering that ticket.
  **In a form** goes back to the form; the agent keeps running.
- **A transcript for the ticket** (Granola, Teams, a file): in the agent's tab press **Import a transcript (paste or
  upload)**, paste it or press **Upload transcript file**, then **Use it**. Grillo types the transcript into the
  agent with `use it` on its last line, then Enter; the agent takes the answers from it (treated as Listen without
  the recording).
- **Done:** in the form, every question answered closes the ticket ("All questions answered…"); questions still
  open return it to the pool, unlocked, with the open ones listed. When closing it leaves no open ticket and no fog,
  Grillo starts the PRD writer (`/grillo-prd`) in a new tab. With an agent, Done only types `done`: the agent
  closes or releases the ticket and starts the PRD writer itself, and the panel shows the outcome once it has.
  The form's Done does the same while the agent it started for that ticket is still answering it, so the ticket
  is never closed twice. An agent that was sent `done` stops counting once its outcome shows or once you take the
  ticket back: the form's Done then closes or releases it, and "With a grilling agent" starts a new agent.
- **Developers:** the screen's id is `own-time`, opened with `{ project: '<owner>/<repo>', ticket: '<number>' }`.
  `npx vitest run src/renderer/screens/own-time` runs its tests against the in-memory store and fake terminals.

## Answer skill

The agent behind own-time answering and the comment pickup is the skill `grillo-answer`, shipped into the project
folder with the other Grillo skills. It records every answer the way the grilling engine does: the contradiction
check, then the source file pushed to `main`, then the answer comment.

- **`/grillo-answer <ticket number>`** (typed by the own-time screen's "With a grilling agent"): the agent takes the
  ticket for you (a ticket someone else holds is refused, naming who holds it), then asks its open questions one at a
  time, with follow-up questions. Each answer is saved with your words as an own-time source ("Grillo, own-time chat
  on ticket #<n>"); an answer that took follow-up questions also keeps the exchange, word for word, as its discussion.
- **Done** (the screen types `done`, or you say it): every question answered posts the decision, closes the ticket,
  adds its line under Settled on the map, and starts `/grillo-prd` when no open ticket and no fog are left. Questions
  still open release the ticket back to the pool, unlocked, with the open ones named. The agent then stops.
- **`/grillo-answer pickup`** (typed by "Pick up GitHub comments" on ticket management, when that control lands):
  every plain comment members wrote on an open ticket in GitHub's web or phone app becomes the answer to the question
  it answers. The source is the comment word for word, with its author and date ("GitHub comment <id> on ticket
  #<n>"); the answer is marked `via: github`, names the comment in `from:`, and names you as the one who recorded it.
  It works on tickets someone else holds and never changes who holds them. A comment that answers no question is left
  as it is. A ticket left with every question answered is closed as Done does.
- **Undo a picked-up answer:** delete its answer comment; the plain comment waits for the next pickup. When that
  pickup also closed the ticket, reopen the ticket too (on the map screen), which takes its line off Settled: the
  pickup leaves closed tickets out, so the comment waits again only once the ticket is open.
- **Run it by hand (developers):** in a clone of a made-up test project with a map, tickets and `.grillo/` on `main`,
  copy `resources/skills/grillo-wayfinder/`, `resources/skills/grillo-prd/` and `resources/skills/grillo-answer/` into
  `.claude/skills/`, start `claude` there and type `/grillo-answer <ticket number>` or `/grillo-answer pickup`. Never
  use real comments or customer text.
- **Developers:** `npx vitest run resources/skills/grillo-answer` checks the skill's frontmatter and its two commands
  against the catalogue, the screen messages it handles against the catalogue's protocol, the sources and answer it
  teaches against grillo-wayfinder's record-answer reference and the store's own parsers, and five fixtures (before,
  after done with a question open, after done with all answered, after a pickup, after the pickup that completes the
  map) against the store layout and the rules of each run.

## Nudges

Grillo reminds you of tickets you took, or were sent, that have had no answer for days. There is no screen: it is
one system notification, "Tickets waiting for your answer", naming each ticket as `#<number> <title> (<project>)`.

- **When:** as Grillo opens, then once a day while it stays open. Nothing silent long enough means no notification.
- **Silent** means an open ticket you hold with no answer recorded for 3 days. Grillo cannot see when a ticket was
  taken, so the count starts at the later of its latest answer and the first time Grillo saw you holding it; a
  ticket released and taken again starts afresh. Only the projects on this laptop's recent list are checked, and
  archived ones are skipped.
- **Change the number of days:** with Grillo closed, set `nudgeAfterDays` (a number above 0) in the app data
  folder's `settings.json`, then open Grillo. Any other value means 3. Grillo keeps its own notes under `nudgeHeldSince` there; leave them.
- **No notification at all?** Check that your system lets Grillo show notifications (on Windows: Settings, System,
  Notifications; on a Mac: System Settings, Notifications). A project Grillo cannot read is skipped and logged; the
  others are still checked.
- **Developers:** `npx vitest run src/main/features/nudges` runs its tests against the in-memory store and a fake
  notifier. The nudges read the app's one store (`appStore` in `src/main/features/store/ipc.ts`), the same
  instance the screens reach over IPC, so one queue guards each project folder.

## Generic agent

The generic agent is the skill `grillo-generic`, shipped into the project folder beside `grillo-wayfinder`. "+" on
the tab bar starts it; the generic agent tab screen arrives with its own story, and until then a developer can run it
by hand.

- **What it does:** `/grillo-generic` asks you to paste the material (a customer email, a document) or tell it in
  your own words, then asks who it is from, when, and how it reached you. It saves the material word for word as a
  source `.grillo/sources/S<n>.md`; with no written source, your own words are the source (your name, the date, how
  you heard it, your exact words).
- **Every clash first:** before changing anything, it runs the contradiction check and shows every clash with a
  recorded answer or decision, quoting it, and asks you how to settle it. Your words that settle a clash become a
  source of their own.
- **Nothing changes without your yes:** it lists the changes (sources, new tickets or questions, answers recorded or
  changed, fog and out-of-scope lines, finished tickets) and writes only the ones you say yes to.
- **Every change is marked** "<login>, via generic agent, <date>": answers, discussions and decisions carry
  `via: generic-agent` in their header lines; a new ticket's "Why it matters", an added question, assumption, fog or
  out-of-scope line ends with `(<login>, via generic agent, <YYYY-MM-DD>)`; a fog line taken off or a question removed
  leaves a marked line in the map's Notes. Earlier answers and sources are never edited: a changed answer is a new
  answer comment, and a clash with a closed ticket opens a `Revisit: <title>` ticket instead of reopening it.
- **The conversation is kept:** every answer it records is followed by a discussion comment holding the chat word for
  word, the pasted material shown as `(pasted: source S<n>)`.
- **Run it by hand (developers):** in a clone of a made-up test project with a map and tickets on GitHub, copy
  `resources/skills/grillo-generic/` and `resources/skills/grillo-wayfinder/` into `.claude/skills/`, start `claude`
  there, type `/grillo-generic` and paste a made-up email. Never use a real customer email.
- **Developers:** `npx vitest run resources/skills/grillo-generic` checks the skill's frontmatter and command against
  the catalogue, the records it teaches against the store's own parsers, and two fixtures (before a pasted email that
  clashed with a recorded answer, and after the run) against the store layout and the generic agent's rules: every
  change marked, every answer followed by its discussion, nothing earlier rewritten.

## Generic agent tab

"+" on the tab bar opens the "New generic agent" dialog: you name the tab, and Grillo starts a generic agent
(`/grillo-generic`, above) in the project folder.

- **Name the tab:** type a name in "Tab name" (for example "Sample customer email"). "Open agent" stays locked
  while the name is empty or only spaces. Enter in the field does the same as "Open agent".
- **Open agent** starts the agent in the folder of the current project (see App shell, above; with none, the
  project opened last on this laptop), in a tab named "Generic · <your name>", and opens that tab. From there it is an ordinary agent tab: the
  agent's terminal and the box under it ("Type to the agent…"); paste the material and say where it came from.
- **No project open:** the dialog says "Open a project from the Project tab to start a generic agent in it." and
  "Open agent" stays locked.
- **The agent did not start** (for example Claude Code is not installed): the dialog says why in red, keeps the
  name, and "Open agent" can be pressed again.
- **Cancel** goes back to the project's map, or to the Project screen when no project is open. Nothing is started.
- **Developers:** the screen is `src/renderer/screens/generic-agent/`, registered as `generic-agent`;
  `npx vitest run src/renderer/screens/generic-agent` checks it.

## Support agent

Release 2 adds a side helper, the skill `grillo-support`, shipped into the project folder beside `grillo-wayfinder`.
The Support tab (below) starts it with `/grillo-support` as the first message; a developer can also run it by hand.

- **Ask it anything** about the project or its agents: what is settled, who holds which ticket, which questions are
  open, what an agent tab is for. It reads GitHub and the project folder fresh and **writes nothing**: no issue,
  comment, label or file.
- **Pass a message to another agent tab on this laptop**: say what it should hear. The support agent shows the exact
  message and the tab it goes to (`Grilling · Who may lend tools`) and asks Send, Change it or Cancel. Only after
  Send does it write a relay request, and Grillo posts the message into that tab's chat as
  `[from Support, for <your login>] <message>`; the reply shows in that tab.
- **The relay request** is a fenced block in the support agent's message: ` ```grillo-relay `, then `to: <tab name>`,
  an empty line, the message, and ` ``` `. The support agent tab reads it with `readRelayRequests` from
  `resources/skills/grillo-support/relay-request.ts`, hands each good one to the agent chat protocol's relay
  (`agent-chat:relay`), and types back one line: `relayed: <tab name>`, or `not relayed: <reason>` (an unknown tab,
  the support tab itself, or a malformed request; a message that writes the mark itself, or whose last line is a
  screen control line such as `done`, is refused so a relay can never press a screen button in the other agent).
- **Run it by hand (developers):** in a clone of a made-up test project with a map on GitHub and `.grillo/` on
  `main`, copy `resources/skills/grillo-wayfinder/` and `resources/skills/grillo-support/` into `.claude/skills/`,
  start `claude` there and type `/grillo-support`. Outside the Support tab nothing reads a relay request, so
  nothing is posted. Never use real customer data.
- **Developers:** `npx vitest run resources/skills/grillo-support` checks the skill's frontmatter and command against
  the catalogue, that it writes nothing, the screen messages it handles, the relay request reader against malformed
  requests, and a fixture support run whose requests go through the real driver and `relay` into a fake target agent,
  each marked for the member.

## Support agent tab

From release 2 the tab bar always shows **Support** as the first agent tab, right after PRD. It is where you talk to
the support agent (above).

- **Open Support:** the first time, Grillo starts the support agent in the folder of the project opened last, with
  `/grillo-support`, in a tab named "Support", and opens that tab. While it starts, the screen shows the "Support
  agent" card and the line "Opening the Support tab: Grillo starts the support agent with `/grillo-support`."
- **From then on** the Support tab is the agent's own tab: its waiting dot and Open channel switch, kept first
  among the agent tabs. Pressing it again opens the same agent; Grillo never starts a second one. When the agent
  stops, the plain Support tab comes back and starts a new one the next time.
- **Pass a message on:** ask the support agent to tell another tab something. It shows the message and the tab and
  waits for your Send; then Grillo posts it into that tab's chat as `[from Support, for <your GitHub login>]
  <message>` and tells the support agent `relayed: <tab name>`. Nothing is posted, and the support agent is told
  `not relayed: <reason>`, when no open tab has that name (the reason lists the open tabs), the target is the
  Support tab itself, the request is malformed, or Grillo cannot read your GitHub login.
- **In the tab the message reached:** the message shows as a bubble on your side with the badge "from Support, for
  `<your login>`" instead of the mark. The tab's right-hand column shows a **Support tab** card: "Relayed to `<tab
  name>`.", where the reply shows, and **Back to Support**, which opens the support agent and takes the card away.
- **Relays need chat agents.** With the terminal runtime (the default until the chat view lands, see Agents) the
  Support tab still starts and opens the agent, but no relay request is read and nothing is posted. Start Grillo
  with `GRILLO_AGENT_RUNTIME=chat` to relay.
- **No project open:** the card says "Open a project from the Project tab to start the support agent in it." and
  nothing starts.
- **The agent did not start** (for example Claude Code is not installed): the card says why in red, with "Try
  again".
- **Developers:** the screen is `src/renderer/screens/support-agent/`, registered as `support-agent`;
  `npx vitest run src/renderer/screens/support-agent` checks the tab's place on the tab bar, the start, and the
  relay answers against a stand-in runtime and relay.

## Research, prototype and task agents

Release 3 adds one agent for each of the other three ticket kinds: the skills `grillo-research`, `grillo-prototype`
and `grillo-task`, shipped into the project folder beside `grillo-wayfinder`. Launch one from its ticket on the Tickets tab (see
"The tickets screen"); a developer can also run them by hand. You may still work such a ticket as grilling
with `/grillo-answer <ticket number>`.

- **Each command works one ticket of its own kind**: `/grillo-research <ticket number>`, `/grillo-prototype <ticket
  number>`, `/grillo-task <ticket number>`. The agent takes the ticket for you (a ticket someone else holds is refused,
  naming who holds it). A ticket of another kind is refused, naming the command that works it.
- **Research** works alone: it reads primary sources only (official documentation, the rule's own text, the
  vendor's own pages) and never answers from memory. Each document becomes a source with its title, link and the
  passage word for word; each answer says how sure it is and what it could not find out. A question no document
  answers stays open, and the agent asks once whether you know where to look.
- **Prototype** works with you: it builds the least that shows the choice (a mock screen, a page outline, a flow), in
  a scratch folder outside the project folder, never committed. It asks what you think of it, one question at a
  time. Your words are the source ("Grillo, own-time chat on ticket #<n>"), and every answer keeps the exchange,
  starting with what the prototype showed, as its discussion.
- **Task** shows its plan first, does alone what it can and gives you numbered steps for the rest. It asks before
  anything that costs money, creates an account or writes to another system. What it did alone is a work record
  source ("Grillo, task agent on ticket #<n>"); what you did is your report in your own words. No password or token
  is ever written down: only where it is kept.
- **Every answer** goes through the engine's order: the contradiction check, then the source pushed to `main`, then
  the answer comment. With every question answered the agent closes the ticket with a decision, adds its line under
  Settled and starts `/grillo-prd` when the map is done; questions still open release the ticket to the pool. The
  agent then stops.
- **Run it by hand (developers):** in a clone of a made-up test project with a map and a ticket of that kind on
  GitHub and `.grillo/` on `main`, copy `resources/skills/grillo-wayfinder/`, `resources/skills/grillo-prd/` and the
  kind's folder into `.claude/skills/`, start `claude` there and type the command. Never use real customer data.
- **Developers:** `npx vitest run resources/skills/grillo-research resources/skills/grillo-prototype
  resources/skills/grillo-task resources/skills/kind-run.test.ts` checks each skill's frontmatter and command against
  the catalogue, the engine sections and screen messages it follows, the records it teaches against the store's own
  parsers, and its fixtures (a research run, a prototype run, and two task runs: one released, one completing the
  map) against the store layout and `resources/skills/kind-run.ts`, the run check of the kind agents.

## PRD

The PRD writer is the skill `grillo-prd`, shipped into the project folder beside `grillo-wayfinder`. Read, export
and regenerate the PRD on the PRD tab ([The PRD view](#the-prd-view) below).

- **When it runs:** by itself the moment the map is done (no open ticket, no fog): the agent that closed the last
  ticket starts `/grillo-prd` itself, through Claude Code's Skill tool. That is why `grillo-prd`, unlike the other
  Grillo skills, leaves `disable-model-invocation` off: with it on, Claude Code refuses an agent that starts the
  skill. Started before the map is done, it says so and writes nothing. `/grillo-prd regenerate` writes a new version on demand, in the current PRD structure,
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

### The PRD view

The **PRD** tab shows the PRD of the current project (see App shell, above; with none, the project opened last on
this laptop). A screen may open it on another project.

- **No PRD yet:** says the PRD is written the moment the map is done, and what is still left (open tickets and fog
  items). **Open the map** goes to the map.
- **Writing:** the screen shows "Writing version <n>" with **Open the writer** while a "Grilling · PRD" tab of this
  project is still working (no waiting dot), and also when the map is done, no version is kept yet and any agent of
  this project runs: the agent that closed the last ticket writes the PRD in its own tab. When an agent of the
  project goes quiet or stops, the screen reads the versions again and shows the new one. Earlier versions stay
  readable below. With the map done, no version and no agent running, it shows "No PRD yet" with nothing left.
- **The version on show:** the latest one first, with its date and "Latest". Every code chip `[S4, Q12.3]` links to
  its entry in the audit appendix; `[no source]` is marked in amber. Raw HTML in a version is shown as text, and
  images as links: nothing in a PRD runs or loads.
- **Versions:** every kept version, numbered and dated, each with **Open**, **Markdown** and **HTML**.
- **Export:** **Download Markdown** saves the stored file `.grillo/prd/v<n>.md` as it is; **Download HTML** saves one
  self-contained page (styles inlined from the liquid glass tokens, nothing fetched) that opens in any browser. Files
  are named `<repo>-prd-v<n>.md` and `.html`; Grillo asks where to save them.
- **Regenerate** starts `/grillo-prd regenerate` in a new "Grilling · PRD" tab and shows Writing; it is greyed while
  a writer is working. **Edit structure and regenerate** opens the structure editor on the Project tab.
  **Talk to an agent about this PRD** starts `/grillo-prd feedback` in a "Grilling · PRD feedback" tab and opens it.
- **Score (release 3):** above the document, the score of the version on show: the overall mark out of 10, then one
  mark (a badge, green from 8, amber at 5 or below, and a bar) and one comment per quality criterion and per section of
  the PRD structure. Each version in the list shows "Score <n.n>" once scored; one not scored yet says so. **Rerun**
  starts `/grillo-score` in a new "Grilling · PRD score" tab and shows "Scoring…" until that tab goes quiet, then the
  new score. Rerun is offered only on the latest version, the only one `/grillo-score` scores. A score file with a
  mark outside 0 to 10 or an empty name shows as an error in the score panel, and the PRD stays readable. A score
  file that is not JSON, or lacks a field, is refused by the store while it reads the versions, so the whole PRD tab
  shows only that error until the file is fixed or `/grillo-score` is run again in an agent tab.
- **Developers:** the screen's id is `prd`, opened with no parameters or `{ project: '<owner>/<repo>' }`; Edit
  structure opens `project-creation` with `{ project, view: 'structure' }`. `npx vitest run src/renderer/screens/prd`
  runs its tests against the in-memory store.

## PRD grader

The PRD grader is the skill `grillo-score` (release 3), shipped into the project folder beside `grillo-prd`. The PRD
view shows its score, with a **Rerun** button ([The PRD view](#the-prd-view) above); the score is the file below.

- **When it runs:** the PRD writer runs `/grillo-score` in the same agent after it saves each version, so every
  generation is scored. Run it again at any time with `/grillo-score`: it scores the latest version and replaces that
  version's earlier score.
- **What it writes:** only `.grillo/prd/v<n>.score.json` on `main`, beside the version it scores: an overall mark
  from 0 to 10, then one mark and one comment for each of eight quality criteria (clear, complete, verifiable, tied
  to objectives, consistent, feasible, needs not solutions, scope and priorities) and for each section of the PRD
  structure (does it hold real decisions or gaps). Each comment says what is weak, why, and ends with
  `Suggestion:` and a concrete change.
- **How the overall is worked out:** quality and coverage weigh half each, every criterion and every section the
  same: (mean of the criteria + mean of the sections) / 2, to one decimal. A structure section the version does not
  write is marked 0.
- **Guidance, not a gate:** nothing happens after a low score. The grader opens no ticket, adds no fog, changes no
  PRD version and starts nothing; to act on a comment, use "Talk to an agent about this PRD" on the PRD view.
- **Run it by hand (developers):** in a clone of a made-up test project with at least one PRD version on `main`,
  copy `resources/skills/grillo-score/`, `resources/skills/grillo-prd/` and `resources/skills/grillo-wayfinder/`
  into `.claude/skills/`, start `claude` there and type `/grillo-score`. Never use a real transcript or customer text.
- **Developers:** `npx vitest run resources/skills/grillo-score` checks the skill's frontmatter and command against
  the catalogue, the score file it teaches against the store's `Score` type, that it writes only the score file, the
  one line in `grillo-prd` that starts it, and its fixture of a project with two scored versions with
  `resources/skills/grillo-score/score-check.ts`: the eight criteria in order, every written section scored, whole
  marks from 0 to 10, a suggestion in every comment, only codes the version cites, and the overall the halves give.

## Updates

Grillo looks for a newer version on its GitHub Releases page when it starts and then every hour while it is open. It
never opens a separate system window: the offer is the update card, drawn inside Grillo.

- **Where the offer shows.** On the setup screen, the update card below the rows. On any other screen, the same card
  as a pop-up over the whole window, which blurs the screen behind it and blocks it until the member answers.
- **Once per version.** The pop-up opens once for each new version found since Grillo started. A version first
  offered while the setup screen was open does not pop up again on the other screens. The pop-up stays open while the
  update downloads (with its percent) and once it is ready ("Restart and install").
- **Found before the window was ready.** Grillo may find a version before its window is listening. So once the first
  screen is open, the window also asks for the current offer: a member who starts on Project still gets the pop-up, and
  a member who lands on the setup check sees it on the card.

- **Download and install** downloads the new version, then closes Grillo, installs it and opens it again.
- **Later** hides that version until Grillo starts again, and closes the pop-up; a newer version is still offered.
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

1. GitHub (the default): `npm run dev` with `GRILLO_STORE` unset.
2. Made-up data in memory: set `GRILLO_STORE=memory` in the shell, then `npm run dev`. Nothing reaches
   GitHub, and the data is gone when the app closes, except the recent-projects list in the settings file. It
   starts with one organisation, three repositories to connect (`example-org/team-code` with write access,
   `example-org/team-docs` with admin, `example-org/company-handbook` read only) and one invitation
   (`example-org/kickoff-notes`), signed in as `ada-example`, the account a project can also go under. Its project folders do not exist on disk, so starting a grilling agent is always
   refused here.

With any other value of `GRILLO_STORE` the app opens no window, and the terminal names the two allowed
values. How the data lives in GitHub is pinned in `docs/store-layout.md`.

### Saves to a protected main

When a project's repository protects its `main` branch, a save cannot go straight in, so it becomes a pull
request (`docs/store-layout.md`, "Saves to a protected main"):

- A note appears above whatever screen is open: "Saved as pull request #<n>, "<title>"…", with **Open on
  GitHub** and **Dismiss**. Someone with the right to merge merges it on GitHub; until then only this app shows
  the change.
- While it waits, the app reads it as saved: the next source or PRD version takes the next number, and a
  session or a version saved a moment ago can be updated or scored again. A change to the same record joins the
  same pull request, so the note does not appear twice.
- After a restart the app no longer knows about pull requests it opened before; merge them before saving more.

### Damaged records

A file in the Grillo folder or a ticket issue edited by hand so that Grillo cannot read it no longer hides the
whole list it belongs to:

- **Project list:** the project shows **Damaged** with the reason (also when its project folder cannot be
  brought up to date with GitHub). Fix the file on GitHub, or the folder, then open the project again.
- **Map and tickets screens:** the ticket shows **Damaged** with the reason, and offers no action. Fix the issue
  on GitHub (one kind label, the sections as Grillo writes them, the comment header). Closing or merging another
  ticket still reports success.
- **PRD view:** a version whose score file cannot be read shows **Damaged** with the reason; **Rerun** writes a
  fresh score over it.

The tickets screen reads the waiting GitHub comments of every open ticket with one listing per project.

## Releases and download site

Installers are built only for a version being published, and a version is published automatically after a merge
that changes the app; the download site is published from `main`.

- **Automatic releases.** Once CI is green on a push to `main`, the `auto-release` workflow runs (one run at a
  time) and asks `scripts/release/next-release.mts` whether the app changed since the latest published release.
  1. **What counts as the app:** `src/`, `resources/`, `build/`, `package.json`, `package-lock.json`,
     `electron-builder.yml`, `electron.vite.config.mts` and `.nvmrc`. A merge that changes nothing on that list
     (docs, agent rules under `.claude/`, the download site, the UX prototype, the workflows, tests outside `src/`)
     ends green with "no app change since `<tag>`" and publishes nothing.
  2. **The version:** the latest release's last number plus one (`0.1.0` then `0.1.1`). `package.json` on `main`
     keeps the version a person set: the workflow writes the new one into `package.json` on its runners only and
     never commits anything to `main`.
  3. **Publishing:** it creates a draft release with the tag `v<version>`, aimed at the commit CI passed, with notes
     GitHub generates from the pull requests merged since the last release. It then runs the `release` workflow's
     build on Windows and Mac, and publishes the draft only once both builds are green.
  4. **A failed build:** the draft is deleted, the run is red under Actions, and nobody is offered anything. The
     next app change tries the same number again.
  - **Raising the major or minor version:** set the new `version` in `package.json` (for example `0.2.0`) in a pull
    request. Changing `package.json` counts as an app change, so the merge publishes `0.2.0` itself, and later
    merges count on from it (`0.2.1`).
  - **Stopping automatic releases:** under Actions, open the `auto-release` workflow and choose "Disable workflow";
    "Enable workflow" turns it back on. Use the paths by hand below only while it is off.
  - **Checking what it would do without releasing:** `node scripts/release/next-release.mts <commit>` (with `gh`
    signed in) prints the version it would publish or why it would not; it only reads, so it is safe to run.
- **Publishing a version by hand** is only for while the `auto-release` workflow is disabled: with it on, the pull
  request that sets the version is an app change and publishes it by itself, and a release made by hand collides
  with it. `package.json` on `main` lags behind the released versions (it stays at the version a person last set),
  so first look up the latest release on the Releases page and pick a higher version. Set that `version` in
  `package.json` in a pull request and merge it, then publish a GitHub release whose tag is that version with a
  leading `v` (for example `v1.0.0`). The `release` workflow then runs the full gate and `npm run dist` on a
  Windows and a Mac runner, and attaches the installers, `latest.yml`, `latest-mac.yml` and their blockmaps
  to the release (installed apps read those to offer the update). A tag that does not match the version fails the
  run before anything is built. The pilot installers are unsigned.
- **What the installers hold.**
  - **Windows:** one x64 installer (`Grillo Setup <version>.exe`, about 114 MB at version 0.1.0).
  - **Mac:** one universal app (Apple silicon and Intel in one file), so every Mac downloads the same
    `Grillo-<version>-universal.dmg` and the update check reads one `-universal-mac.zip`. The release job adds
    the speech engine for the chip npm skipped, checked against `package-lock.json`, before it builds.
  - **Left out:** the speech engine's graphics-card builds (CUDA, Vulkan) and its browser build (WASM). Grillo
    never loads them, and on Windows they added about 110 MB to the installer.
- **Building an installer on your own machine:** `npm run dist` (Windows builds the `.exe`, a Mac the `.dmg` and
  `.zip`, into `dist/`). Nothing is compiled from source: node-pty and the speech engine ship ready-made binaries
  that Electron loads as they are, so no Visual Studio or Xcode setup is needed. Use the Node version in `.nvmrc`
  (24.22.2, a long-term-support release).
- **Trying it first on a draft release** (also only while `auto-release` is disabled; nothing is offered to
  installed apps until it is published):
  1. Set a version higher than the latest release in `package.json` on `main`, as above, then create a draft
     release with the tag `v<that version>`; do not publish it.
  2. Under Actions, run the `release` workflow by hand from `main`, giving that tag.
  3. Check that both runs pass and that the draft now lists the `.exe`, `.dmg`, `.zip`, both `latest*.yml` files
     and the blockmaps; then publish the draft or delete it.
- **The download site** is the static page in `site/`. The `pages` workflow publishes it on every push to `main`,
  but only once Pages is switched on; until then its runs are skipped, not failed. To switch it on:
  1. Settings, Pages: set the source to "GitHub Actions".
  2. Settings, Secrets and variables, Actions, Variables: add the repository variable `PAGES_ENABLED` = `true`.
  3. Under Actions, run the `pages` workflow by hand once (or push to `main`).

  The page asks GitHub for the latest release when it opens and points the download buttons at its installers;
  without an answer they open the releases page. It also puts the download button for the visitor's own system
  (Windows or Mac) first and fills only it; on any other system both stay filled, Windows first.
- **Once the installers are signed**, set `data-installers="signed"` on the `<html>` element of `site/index.html`:
  the "Run anyway" and "Open Anyway" steps disappear, and the hero badge and the
  install section say the installers are signed.
- Open `site/index.html` from disk to check its look; putting the visitor's own system first and the latest-release
  lookup only run when it is served by a web server (any local static server will do).
