# How Grillo keeps its data in GitHub

Every backend and every engine skill follows this document, so a record written by one is read by the
others. The records themselves are PRD section 6.1; the interface over them is `Store` in
`src/main/store/store.ts`. A change here is a change to both GitHub backends and to the engine skills.

## Contents

1. [One project, one repository](#one-project-one-repository)
2. [The Grillo folder](#the-grillo-folder)
3. [Labels](#labels)
4. [The map and its tickets](#the-map-and-its-tickets)
5. [Comment markers](#comment-markers)
6. [Codes: S, Q and v](#codes-s-q-and-v)
7. [The claim rule](#the-claim-rule)
8. [Saves to a protected main](#saves-to-a-protected-main)
9. [Merging tickets](#merging-tickets)
10. [Recent projects](#recent-projects)

## One project, one repository

A project is one GitHub repository, named `<owner>/<repo>`: a new private one Grillo creates in the
organisation, or an existing one the member connects. One Grillo project per repository. Closing a project
archives its repository; unarchiving reopens it.

## The Grillo folder

Everything long lives as files in `.grillo/` on `main` of the project repository:

| File | Holds |
|---|---|
| `.grillo/members.json` | One entry per member: `login`, `role`, `domains`. Name and email come from GitHub. |
| `.grillo/structure.json` | The PRD structure: the ordered sections, each a `name` and a one-line `note`. |
| `.grillo/sources/S<n>.md` | One source: kind, who, when, where, and the text word for word. |
| `.grillo/sessions/<date>-<time>.md` | One grilling session: date, who was present, the consent record, the full transcript. |
| `.grillo/prd/v<n>.md` | One PRD version: the Markdown body with its codes, then the audit appendix. |
| `.grillo/prd/v<n>.score.json` | The score of PRD version `n`: overall, per criterion and per section, each a mark and one comment. |

A session's `<date>-<time>` is the moment it started, in UTC, as `YYYY-MM-DD-HHMMSS`
(`2026-10-24-091500`).

## Labels

| Label | On |
|---|---|
| `wayfinder:map` | The project's one map issue. |
| `wayfinder:grilling`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:task` | Each ticket, exactly one: its kind. |
| `domain:<name>` | A ticket tagged with a domain some member declared. |
| `domain:none` | The visible "no domain" tag: the ticket fits nobody and is open to anyone. Never together with a `domain:<name>`. |

Grillo sees only issues carrying these labels; any other issue in a connected repository is ignored.

## The map and its tickets

The map is one issue labelled `wayfinder:map` with the sections destination, notes, settled (one gist line
per closed ticket), fog and out of scope. Every ticket is a native sub-issue of the map. A ticket's blockers
are set twice: GitHub's native "blocked by" relation for people and a `### Blocked by` body section for
agents. The ticket's assignee is its claim.

## Comment markers

Answers, discussions and decisions are comments on their ticket. Each starts with a marker line, then
header lines, then the text:

```
<!-- grillo:answer -->
who: ada-example
when: 2026-10-24T09:15:00.000Z
sources: S1, S4
via:
The text of the answer.
```

| First line | Record |
|---|---|
| `<!-- grillo:answer -->` | An answer to one question. |
| `<!-- grillo:discussion -->` | The talk around an answer, word for word. |
| `<!-- grillo:decision -->` | The ticket's final answer; its gist line goes on the map. |

Header lines, in this order:

- `who:` the login who recorded it.
- `when:` the moment, ISO 8601 in UTC.
- `sources:` the codes it rests on, comma-separated; empty when none.
- `via:` empty when typed in Grillo, `github` when turned from a member's comment written in GitHub's own
  app, `generic-agent` when recorded by a generic agent.

A comment with no marker is a plain member comment: one written in GitHub's web or phone app, waiting to be
turned into an answer.

## Codes: S, Q and v

- **Questions:** `Q<issue number>.<k>`, the `k`-th question of the ticket with that issue number. Unique
  because GitHub allocates issue numbers. A removed question's code is never reused.
- **Sources and PRD versions:** `S<n>` and `v<n>` take the next free number read from `main` after
  `git pull --ff-only`, then the file is written and pushed. A rejected push means someone wrote first: pull,
  renumber your own file to the next free number, push again.
- **A number never changes once pushed.** PRD versions cite sources and questions by these codes.

## The claim rule

Taking a ticket is atomic (PRD section 4.3 item 6):

1. Assign yourself.
2. Re-read the assignees.
3. If another login is also assigned, the earlier `assigned` event in the issue's timeline wins, and the
   later one unassigns itself.

Agents follow the same rule through `gh`.

## Saves to a protected main

Every save to the Grillo folder is first a direct push to `main`. When the repository refuses it (a
protected `main`), Grillo opens a pull request with the change and tells the member.

## Merging tickets

Merging a ticket into another closes it as a duplicate, with a decision comment pointing at the other
ticket.

## Recent projects

Not in GitHub: a list in the app's settings file under the key `recentProjects`, one entry per project,
`{ "project": "<owner>/<repo>", "lastOpened": "<ISO 8601>" }`, last opened first.
