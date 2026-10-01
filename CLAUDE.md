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
permissions, the do-not-build list, the demo as the acceptance bar, the build decisions — is read from
`docs/initialRequirements/PRD.md`, never restated here. **Disagreement between the two is a bug**: the PRD wins on product,
this file wins on process.

- **Follow the design system named in the PRD from the first line of frontend code.** No "build it plain, style it
  later". A generically-styled screen **fails its acceptance criteria** and the reviewer blocks it on that alone.
- **Never invent a colour or a spacing value.** If it is not in the token file, it does not go in.
- **Code, comments, commits, issues and docs in English.** Interface language is a product decision — see the PRD.
- **External systems are mocked in-process.** Each sits behind one swappable interface.
- **Take every reversible decision yourself** — simplest option that meets the acceptance criteria, recorded in the pull
  request. Only a genuinely irreversible one becomes `needs-human`. A run that waits costs money doing nothing.

## 3 · Git

- **NEVER push to `main`. Ever.** Not a fix, not a typo, not "it is only a doc". Every single change reaches `main` as a
  pull request that is then merged. Agents have full autonomy to open, review and merge that pull request — they have no
  autonomy to skip it. Nothing on GitHub's side enforces this; it holds because you do.
- **One issue = one worktree = one branch `feature/<issue>-<slug>` = one pull request.** Never work in the main checkout.
- Worktrees live at **`C:\wt\<issue>-<slug>`**, never inside the project — Windows path limits bite once `node_modules` exists.
- Update a branch with `git merge origin/main` — **never rebase, never stash**.
- Never force-push. Never `git add -A`. Never delete work you did not create.
- Conventional Commits: `type(scope): summary`.

## 4 · Definition of done

- **Full build and full suite green before the pull request opens.** Every new behaviour has a test.
- **Never delete, skip or weaken a test. Never widen a timeout.** The skip count is baselined; a change to it is a failure.
- The pull request body carries the **evidence table** — what you did, what you expected, what you saw. There are no browser
  tests, so a green suite alone is *not* evidence that a screen works.
- A **fresh agent** reviews every pull request and runs the suite itself — never the agent that wrote the code.
- **Never merge on red or pending.** "No checks reported" is red. Poll for the check run first: GitHub can take four minutes.
- Branch protection is unavailable on this plan, so nothing enforces these but you. That is the deal.

## 5 · Build and test commands

Written down because there is nothing to auto-detect. Every agent uses exactly these; the scaffold must make them true.

| Purpose | Command |
|---|---|
| Build | `npm run build` |
| **The full suite** | `npm test` |
| One file | `npx vitest run src/x.test.ts` |
| One test | `npx vitest run -t "<test name>"` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Apply migrations | `npm run db:migrate` |
| Create a migration | `npx prisma migrate dev --name <issue>-<what-changed>` |
| Reset database | `npm run db:reset` |
| Seed | `npm run db:seed` |
| Dev server | `npm run dev` |

**The gate, before any pull request opens:** `npm run build && npm run typecheck && npm test`

- Stack: **Next.js (App Router) · TypeScript · Prisma · PostgreSQL · npm · Node 22 · Vitest**. Hosted on Railway; `main` auto-deploys.
- **Node 22**: `engines` in `package.json` sets the floor (`>=22`) and the committed `.nvmrc` pins `22` for version managers. Six laptops, one runtime.
- **Local database:** PostgreSQL 16 from the committed `docker-compose.yml`, published on port **15432** (not 5432 — a native PostgreSQL owns 5432 on at least one team machine), user and password `postgres`. `.env.example` carries the matching URL and a test asserts the two agree.
- **Seed data grows per area, never in one shared file.** `prisma/seed.ts` is the loader; a story that adds seed data puts it in `prisma/seed/<area>.ts` and imports it there, so two branches never append to the same file.
- **Schema changes are versioned migration files** (`prisma/migrations/`), so nothing is ever silently dropped. Three rules
  keep parallel branches from fighting over them: name every migration `<issue>-<what-changed>`; **never edit or delete a
  migration that has reached `main`** — correct it with a new one; and after `git merge origin/main`, run `npm run db:migrate`
  before anything else, so you are running on everyone else's schema and not just your own.
- **Per worktree:** database `grillo_<issue>` in your own Docker Postgres; dev server on port `3000 + <issue>`.
  Kill a server **by process id, never by image or process name** — you will kill a teammate's.
- `DATABASE_URL` and secrets live in a gitignored `.env` beside the committed `.env.example`. **Never commit a secret.**
- CI runs `npm ci && npm run lint && npm run build && npm run typecheck && npm test` on every pull request.

## 6 · Deferred findings

Small and safe → fix it in the same pull request. Critical → a GitHub issue, linked from the pull request.
Everything else → one line in `docs/deferred/<issue>.md`, **one file per issue** — a shared list conflicts on every branch.
In doubt, the list. Never open an issue "to be safe"; a backlog nobody drains is worse than no backlog.

## 7 · Communication

TLDR first. One-liners. Numbered steps, one action per line. End with exactly one next action.
Always qualify a number — `issue #12` or `PR #12`, never a bare `#12`. No preamble, no recap, no sign-off.

## Known shell traps on this team's machines (Windows)

- PowerShell 5.1 has **no `&&`** — use `A; if ($?) { B }`. No ternary, no `??`.
- Writing an issue or PR body: PowerShell adds a byte-order mark and bash heredocs break on apostrophes. Write it with
  Python `open(..., encoding="utf-8")`, then pass `--body-file`. `Set-Content` also defaults to ANSI — pass `-Encoding utf8`.
- `gh` and `node` may be off PATH in a fresh shell — check in preflight, do not assume.
- `index.lock` means another terminal is mid-command. Wait 5 seconds, retry 3 times.
