Mandatory rules, owned and refreshed by orion (never edit the copy): @.claude/orion/BASE_CLAUDE.md

# CLAUDE.md — Grillo

Start every answer with 🚦. If it disappears, this file has fallen out of context — start a fresh session.

Read this file before doing anything. It is configuration, not documentation. Changing a rule is a pull request with a reason.

## 1 · Work tracking

- **GitHub Issues are the only source of truth.** PRD → epic → story. Agents implement **stories** only, never an epic directly.
- **The assignee owns the issue.** Claim by assigning yourself *before* writing any code. Never work on, edit or unassign someone else's.
- Wait until **every issue under `### Blocked by` is CLOSED**. Not "nearly done" — closed.
- The one sanctioned read: `gh issue view N --json title,body,labels,comments`. The plain form drops the body.
- Labels: `epic` `story` `agent-ready` `needs-human` `in-progress`. `agent-ready` means nothing is left to ask.
  `needs-human` means you explained why in a comment, released the issue, and moved on.

## 2 · Standing decisions — never ask about these

**The PRD is the product; this file is how we build it.** Every product fact — vocabulary, screens, data model,
permissions, the do-not-build list, the demo as the acceptance bar, the build decisions — never restated here. **Disagreement between PRD and claude.md is a bug**: the PRD wins on product,this file wins on process.

- **Follow the design system named in the PRD from the first line of frontend code.** The PRD names the **liquid
  glass** theme (see-through, frosted panels); its colour and spacing token file comes from the UX prototype under
  `docs/ux/prototypes/`. No "build it plain, style it later". A generically-styled screen **fails its acceptance
  criteria** and the reviewer blocks it on that alone.
- **Never invent a colour or a spacing value.** If it is not in the token file, it does not go in.
- **Code, comments, commits, issues and docs in English.** Interface language is a product decision — see the PRD.
- **External systems are mocked in-process.** Each sits behind one swappable interface.
- **Take every reversible decision yourself** — simplest option that meets the acceptance criteria, recorded in the pull
  request. Only a genuinely irreversible one becomes `needs-human`. A run that waits costs money doing nothing.

## 3 · Git

- **One issue = one worktree = one branch `feat/<issue>-<slug>` = one pull request.** Never work in the main checkout.
- Worktrees live at **`C:\wt\<issue>-<slug>`**, never inside the project — Windows path limits bite once `node_modules` exists.
- **Port rule:** each worktree's dev server listens on **`5173 + <issue number>`**, carried in the env variable
  **`GRILLO_DEV_PORT`** (set it before `npm run dev`), so two stories never fight over one port.
- Update a branch with `git merge origin/main` — **never rebase, never stash**.
- Never force-push. Never `git add -A`. Never delete work you did not create.
- Conventional Commits: `type(scope): summary`.

## 4 · Definition of done

- **Full build and full suite green before the pull request opens.** Every new behaviour has a test.
- **Never delete, skip or weaken a test. Never widen a timeout.** The skip count is baselined; a change to it is a failure.
- The pull request body carries the **evidence table** — what you did, what you expected, what you saw. There are no browser
  tests, so a green suite alone is *not* evidence that a screen works.
- **Never merge on red or pending.** "No checks reported" is red. Poll for the check run first: GitHub can take four minutes.
- **While the GitHub account has no Actions minutes (since 2026-10-28), this project counts as having no CI.** Both CI
  jobs fail within seconds on billing, before any step runs; that is not a check result. The merge gate is then the
  "no CI exists" path of `.claude/skills/dev-next/references/merge-and-ci.md`: the full gate (section 5) run on the
  merged branch in the worktree, and a red local run is still red. Nothing is tested on Mac meanwhile, so say so in
  every pull request's evidence table. A CI job that ran its steps and failed is red as ever. Delete this rule when
  the minutes return.
- **A story that changes a screen starts the app once** (`npm run dev`, on its `GRILLO_DEV_PORT`) and tries every
  control it changed before the first review: the test browser ignores some style rules, so a hidden or misplaced
  control can pass the suite. Record what was tried in the evidence table.
- Branch protection is unavailable on this plan, so nothing enforces these but you. That is the deal.

## 5 · Build and test commands

**The stack is decided by PRD v1 (section 8, Build decisions): Electron, one TypeScript codebase for Windows and
Mac.** Every agent uses exactly these commands. The scaffold has landed (issue #56), so every command below is real.

| Purpose | Command |
|---|---|
| Build | `npm run build` (`electron-vite build`) |
| **The full suite** | `npm test` (`vitest run`) |
| One file | `npx vitest run <path>` |
| One test | `npx vitest run <path> -t "<test name>"` |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Lint | `npm run lint` (`eslint .`) |
| Dev server | `npm run dev` (`electron-vite dev`, on the port `GRILLO_DEV_PORT` names) |
| Installers | `npm run dist` (`electron-builder`) — only when a version is published, never in the gate |

No database, no migrations, no seed: the store is GitHub Issues through `gh` behind one swappable interface (PRD
section 6.3), and nothing central runs (PRD section 8, Hosting).

**The gate, before any pull request opens:** `npm run build && npm run lint && npm run typecheck && npm test` — the
same chain CI runs.

**Only one full run at a time on this machine.** Several sessions run here at once, and parallel full suites fail on
time limits. Wrap every full gate or `npm test` in the machine-wide lock, moving into the worktree *inside* the
command, and print the folder and commit first so a run in the wrong checkout is visible:
`bash /c/wt/with-gate-lock.sh <agent name> bash -c 'cd /c/wt/<issue>-<slug> && pwd && git rev-parse HEAD && <gate>'`.
Check that vitest's `RUN` line names the worktree. One test file needs no lock.

**Tests never touch real GitHub.** No test, check or probe creates, edits or deletes anything on github.com: prove
store code with the made-up GitHub the store's own tests use (`src/main/store/github/repo/fake-github.ts`), or with
real `git` against a local bare repository behind a fake `gh`.

- **Stack and layout.** Language: TypeScript on Electron; renderer, preload and main process bundled by
  electron-vite (one config and one `dev` command for all three, where plain Vite needs a separate Electron launcher).
  Runtime: the current Node LTS when the scaffold lands, exact version pinned in `.nvmrc` and mirrored in `engines`
  of `package.json`; package manager npm, lockfile committed. Terminals: xterm.js + node-pty (its native build must
  match Electron's ABI). Tests: Vitest; test files sit beside the code they test as `*.test.ts`. Application code
  path: `src/` (`src/main/`, `src/preload/`, `src/renderer/`). Skip-count baseline: **0**.
- **CI** is GitHub Actions (`.github/workflows/ci.yml`) on GitHub-hosted **Windows and Mac** runners: every pull
  request runs the gate chain above on both; installers are built only when a version is published (PRD section 8,
  CI). Each runner also runs orion's install check before the gate.
- Kill a server **by process id, never by image or process name** — you will kill a teammate's.
- **Never commit a secret.**

## 6 · Communication

MANDATORY to talk to me using TLDR first and One-liners (highest priority if possible). Numbered steps, one action per line. End with exactly one next action.
Always qualify a number — `issue #12` or `PR #12`, never a bare `#12`. No preamble, no recap, no sign-off.

## 7 · Boundaries

- Deploy target: **GitHub Releases** (the installers) and the **GitHub Pages** site of Grillo's own repository, from
  `main` only (PRD section 8, Distribution). Nothing central: no Grillo server, no database.
- External read-only repositories: **none** today. The company GitHub repositories Grillo creates for its users'
  projects are product data, not code this team changes.
- Sensitive data classes that must never enter the repository: real meeting transcripts or recordings, real customer
  emails, personal data of any colleague, and Claude or GitHub tokens. Fixtures and demo materials are made up only
  (PRD section 11, Materials).
- Boundaries an agent must not move: the eight items of the PRD's do-not-build list (PRD section 10) and the fixed
  rules in PRD section 1.1. Changing either is a PRD change by a person, never a story.
- Working language: English (see Standing decisions).

## 8 · Pending until PRD v1

Every question (stack and runtime, database, hosting, CI runner and gate steps) was answered by PRD v1 on 2026-10-22
and written into sections 5 and 7 above. Nothing is pending.

