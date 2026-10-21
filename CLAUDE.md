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

- **Follow the design system named in the PRD from the first line of frontend code.** No "build it plain, style it
  later". A generically-styled screen **fails its acceptance criteria** and the reviewer blocks it on that alone.
- **Never invent a colour or a spacing value.** If it is not in the token file, it does not go in.
- **Code, comments, commits, issues and docs in English.** Interface language is a product decision — see the PRD.
- **External systems are mocked in-process.** Each sits behind one swappable interface.
- **Take every reversible decision yourself** — simplest option that meets the acceptance criteria, recorded in the pull
  request. Only a genuinely irreversible one becomes `needs-human`. A run that waits costs money doing nothing.

## 3 · Git

- **One issue = one worktree = one branch `feat/<issue>-<slug>` = one pull request.** Never work in the main checkout.
- Worktrees live at **`C:\wt\<issue>-<slug>`**, never inside the project — Windows path limits bite once `node_modules` exists.
- Update a branch with `git merge origin/main` — **never rebase, never stash**.
- Never force-push. Never `git add -A`. Never delete work you did not create.
- Conventional Commits: `type(scope): summary`.

## 4 · Definition of done

- **Full build and full suite green before the pull request opens.** Every new behaviour has a test.
- **Never delete, skip or weaken a test. Never widen a timeout.** The skip count is baselined; a change to it is a failure.
- The pull request body carries the **evidence table** — what you did, what you expected, what you saw. There are no browser
  tests, so a green suite alone is *not* evidence that a screen works.
- **Never merge on red or pending.** "No checks reported" is red. Poll for the check run first: GitHub can take four minutes.
- Branch protection is unavailable on this plan, so nothing enforces these but you. That is the deal.

## 5 · Build and test commands

**The tech stack is not decided yet.** Every command below is open. The pull request that decides the stack fills this
section in; from then on every agent uses exactly those commands and the scaffold must make them true.

| Purpose | Command |
|---|---|
| Build | `TBD` |
| **The full suite** | `TBD` |
| One file | `TBD` |
| One test | `TBD` |
| Typecheck | `TBD` |
| Lint | `TBD` |
| Dev server | `TBD` |

Add rows as the chosen stack needs them (typecheck, database migrations, seed).

**The gate, before any pull request opens:** `TBD` — the build plus the full suite, once they exist. Until
then there is nothing to build or test; say so in the pull request body.

- Stack, runtime version, database, hosting and CI: **all to be decided**. Do not assume any of them.
- Kill a server **by process id, never by image or process name** — you will kill a teammate's.
- **Never commit a secret.**

## 7 · Communication

MANDATORY to talk to me using TLDR first and One-liners (highest priority if possible). Numbered steps, one action per line. End with exactly one next action.
Always qualify a number — `issue #12` or `PR #12`, never a bare `#12`. No preamble, no recap, no sign-off.

## 8 · Boundaries

- Deploy target: `TBD`.
- External read-only repositories: `TBD`.
- Sensitive data classes that must never enter the repository: `TBD`.
- Boundaries an agent must not move: `TBD`.
- Working language: English (see Standing decisions).

## 9 · Pending until PRD v1

| Question | Decides (file · section) | Who decides |
|---|---|---|
| Tech stack and runtime version | CLAUDE.md · Build and test commands | `TBD` |
| Database | CLAUDE.md · Build and test commands | `TBD` |
| Hosting | CLAUDE.md · Boundaries | `TBD` |
| CI runner and gate steps | CLAUDE.md · Build and test commands; .github/workflows/ci.yml | `TBD` |


