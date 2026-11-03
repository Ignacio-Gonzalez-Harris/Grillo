# How Grillo keeps its data in GitHub

Every backend and every engine skill follows this document, so a record written by one is read by the
others. The records themselves are PRD section 6.1; the interface over them is `Store` in
`src/main/store/store.ts`. A change here is a change to both GitHub backends and to the engine skills.

## Contents

1. [One project, one repository](#one-project-one-repository)
2. [Header lines](#header-lines)
3. [The Grillo folder](#the-grillo-folder)
4. [Labels](#labels)
5. [The map issue](#the-map-issue)
6. [Ticket issues](#ticket-issues)
7. [Comment markers](#comment-markers)
8. [Tags set by hand](#tags-set-by-hand)
9. [Codes: S, Q and v](#codes-s-q-and-v)
10. [The claim rule](#the-claim-rule)
11. [Saves to a protected main](#saves-to-a-protected-main)
12. [Merging and reopening tickets](#merging-and-reopening-tickets)
13. [Recent projects](#recent-projects)

## One project, one repository

A project is one GitHub repository, named `<owner>/<repo>`: a new one Grillo creates, or an existing one the
member connects. One Grillo project per repository. Closing a project archives its repository; unarchiving
reopens it.

A new repository's owner is one of the member's organisations, always private, or their own account, private
unless `visibility` says public. The store itself refuses public for any owner but the signed-in account (compared
without regard to case), so an organisation's repository stays private whatever a caller sends. In the store's
`newRepository`, `organisation` names the owner of either kind. A public repository exposes everything below to
anyone.

A repository Grillo creates carries the repository topic `grillo-created`. Members invited to one in an
organisation become repository admins (PRD section 7); members invited to a connected repository in an organisation
get write access. **A personal repository** (GitHub's `owner.type` is `User`), created or connected, has only an
owner and collaborators: an invite sends no `permission` value, a collaborator reads as write access, and only the
owner can invite, close and reopen. The Grillo folder lives on the repository's default branch, called `main` in this document.

## Header lines

Source files, session files, PRD version files and Grillo's comments share one way of keeping fields
apart from long text:

- A block of **header lines** comes first, each `<name>: <value>`, in the order this document gives, every
  line present even when its value is empty (nothing after `<name>:`).
- A value is one line: a line break inside it is written as a space.
- A list value is comma-separated (`S1, S4`); an empty list is an empty value.
- Moments are ISO 8601 in UTC (`2026-10-24T09:15:00.000Z`).
- The **first empty line** ends the header block. Everything after it, to the end of the file or comment,
  is the long text, kept exactly as written (it may hold empty lines of its own).

## The Grillo folder

Everything long lives as files in `.grillo/` on `main` of the project repository:

| File | Holds |
|---|---|
| `.grillo/members.json` | One entry per member: `login`, `role`, `domains`. Name and email come from GitHub. |
| `.grillo/structure.json` | The PRD structure. |
| `.grillo/sources/S<n>.md` | One source. |
| `.grillo/sessions/<date>-<time>.md` | One grilling session. |
| `.grillo/prd/v<n>.md` | One PRD version: its body, then its audit appendix. |
| `.grillo/prd/v<n>.score.json` | The score of PRD version `n`; no file until the version is scored. |

**`members.json`**, a JSON list in members-file order:

```json
[{ "login": "ada-example", "role": "developer", "domains": ["platform"] }]
```

**`structure.json`**, the sections in order:

```json
{ "sections": [{ "name": "Problem", "note": "What goes wrong today, and the outcomes wanted" }] }
```

**`sources/S<n>.md`**: header lines `kind:` (`meeting`, `own-time-answer`, `pasted-text` or `document`),
`who:`, `when:`, `where:`, then the text word for word.

```
kind: pasted-text
who: Ben Example, product
when: 2026-10-23T10:00:00.000Z
where: email to Ada

The text of the source, word for word.
```

**`sessions/<date>-<time>.md`**: `<date>-<time>` is the moment the session started, in UTC, as
`YYYY-MM-DD-HHMMSS` (`2026-10-24-091500`). Header lines `date:`, `present:` (logins), `consent-by:` and
`consent-at:` (both empty until the host ticks consent), then the full transcript.

```
date: 2026-10-24T09:15:00.000Z
present: ada-example, ben-example
consent-by: ada-example
consent-at: 2026-10-24T09:16:00.000Z

The transcript, as spoken.
```

**`prd/v<n>.md`**: header lines `version:` and `date:`, then the Markdown body with its `[S<n>, Q<n>.<k>]`
codes. The audit appendix starts at the first line that reads exactly `<!-- grillo:appendix -->`; the body
is everything before that line and never contains it, the appendix everything after it.

```
version: 2
date: 2026-10-24T11:00:00.000Z

# The PRD body ...

<!-- grillo:appendix -->
# Audit appendix ...
```

**`prd/v<n>.score.json`**: every mark is a number from 0 to 10.

```json
{
  "overall": 6.5,
  "criteria": [{ "name": "Clear", "mark": 7, "comment": "Mostly plain words" }],
  "sections": [{ "name": "Problem", "mark": 6, "comment": "Outcomes are vague" }]
}
```

## Labels

| Label | On |
|---|---|
| `wayfinder:map` | The project's one map issue. |
| `wayfinder:grilling`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:task` | Each ticket, exactly one: its kind. |
| `domain:<name>` | A ticket tagged with a domain some member declared. |
| `domain:none` | The visible "no domain" tag: the ticket fits nobody and is open to anyone. Never together with a `domain:<name>`. |

Grillo sees only issues carrying these labels; any other issue in a connected repository is ignored.

## The map issue

One issue labelled `wayfinder:map`, titled `Map`. Its body holds these sections, in this order, each a
`### ` heading followed by its content (an empty section keeps its heading):

```
### Destination
A PRD for ...

### Notes
Free text.

### Settled
- #12 Sign in with GitHub only

### Fog
- Pricing is unclear

### Out of scope
- A mobile app
```

Settled holds one line per ticket, `- #<ticket issue number> <gist>`, with the gist of its latest decision: a new
decision replaces the line, and editing or deleting the latest one follows on it (deleting it brings back the one
before, or takes the line off). Fog and out of scope hold one `- ` line per item. A line under Out of scope that
names a ticket as `#<number>` means that ticket was closed as out of scope: it has no line under Settled, even if
it carried a decision, until it is reopened.

**Two laptops writing at once.** GitHub has no conditional write for an issue body, so every change of the body is
read, changed, written and read again. While the fresh body does not hold the change, it is applied to that body and
written again, up to five times; then the change is refused as a conflict. A write from another laptop that landed
just after that last read can still lose a line; closing the ticket again writes its line back.

A fog line an engine skill writes starts with the name of the PRD structure section it belongs to, exactly as
`structure.json` spells it, then `: ` (`- Problem: pricing is unclear`), so a skill can tell which sections are
covered.

## Ticket issues

Every ticket is a native sub-issue of the map. Its title is the ticket's title; its kind and domains are
labels; its assignee is its claim; its state is the issue's state. Its body holds these sections, in this
order:

```
### Question
How do members sign in?

### Why it matters
Every screen needs a member.

### Assumptions
- GitHub accounts exist

### Questions
- Q12.1 Which provider?
- Q12.2 (removed)
- Q12.3 Is single sign-on needed?

### Blocked by
- #9
```

- **Questions:** one line per question, `- Q<issue number>.<k> <text>`, in order. The ticket's issue number
  is known only once the issue exists, so the questions are written by an edit right after the issue is
  created. A removed question keeps its line as `- Q<n>.<k> (removed)`, so the next question takes the
  highest `k` plus one and a code is never reused.
- **Why it matters:** on a ticket an engine skill writes, it starts with the name of the PRD structure section
  its answers feed, exactly as `structure.json` spells it, then `: ` (`Users and roles: every screen needs a
  member.`).
- **Answered:** a question is answered when an answer comment on the ticket names its code in `question:`.
- **Blocked by:** one `- #<issue number>` line per blocker, set together with GitHub's native "blocked by"
  relation; the two always agree.

## Comment markers

Answers, discussions and decisions are comments on their ticket. Each starts with a marker line, then its
header lines (see [Header lines](#header-lines)), then the text:

| First line | Record | Header lines, in order | Text |
|---|---|---|---|
| `<!-- grillo:answer -->` | An answer to one question | `who:`, `when:`, `sources:`, `via:`, `question:`, `from:` | The answer |
| `<!-- grillo:discussion -->` | The talk around an answer | `who:`, `when:`, `sources:`, `via:`, `question:`, `session:` | The transcript segment, word for word |
| `<!-- grillo:decision -->` | The ticket's final answer | `who:`, `when:`, `sources:`, `via:`, `gist:` | The decision |

- `who:` the login who recorded it.
- `when:` the moment it was recorded.
- `sources:` the codes it rests on (`S1, S4`); empty when none.
- `via:` empty when typed in Grillo, `github` when turned from a member's comment written in GitHub's own
  app, `generic-agent` when recorded by a generic agent.
- `question:` the code of the question it belongs to (`Q12.1`).
- `from:` on an answer turned from a plain member comment, that comment's id; empty otherwise.
- `session:` the session file the segment was cut from (`.grillo/sessions/2026-10-24-091500.md`); empty when
  the discussion was typed.
- `gist:` the one line the map's settled list shows for this ticket.

```
<!-- grillo:answer -->
who: ada-example
when: 2026-10-24T09:15:00.000Z
sources: S1, S4
via: github
question: Q12.1
from: 2412345678

Sign in with GitHub only.
```

A comment with no marker is a plain member comment: one written in GitHub's web or phone app. It waits to be
turned into an answer until an answer comment names its id in `from:`; deleting that answer puts it back.

### Comments in a public repository

Anyone can comment on a public repository, and nothing stops them writing a marker line and any `who:`. So in a
repository GitHub does not call private (`private: true`; a missing value counts as public), a comment counts only
when its `author_association` is exactly `OWNER`, `MEMBER` or `COLLABORATOR`. Any other value, or none, means the comment
does not exist for the store: no answer, discussion, decision, tags-by-hand marker or plain comment, and it cannot damage a
ticket. The value is read afresh every time, so **once GitHub stops calling someone a collaborator after they leave,
their comments stop counting** (GitHub's documentation does not say when the value changes, and this was not tried
against real GitHub): their answers read as unanswered again and their decisions as gone, though the map's settled
lines stay until a member changes them. In a public organisation repository `MEMBER` means any member of that
organisation. A private repository reads every comment, as always.

An agent reads comments through `gh`, not the store, so there this is an instruction (every `SKILL.md`, "Ground rules",
and `record-answer.md`), never enforced. An outsider's issue is no ticket: GitHub drops the labels of someone with
no push access, and Grillo reads only labelled issues.

## Tags set by hand

A tagging round (`/grillo-tagging`) gives every open ticket its domain labels, and is run again as members
join. A member who sets a ticket's domain labels by hand protects them from every later round with a
**tags-by-hand marker**: a comment on the ticket, written right after the labels change, whose first line is
`<!-- grillo:tags-by-hand -->`, followed by these header lines (see [Header lines](#header-lines)):

- `who:` the login who set the tags; the comment's author.
- `when:` the moment they were set.
- `domains:` the domains set (`product, platform`), or `none` for the "no domain" tag. Never empty, never
  `none` together with a domain.

```
<!-- grillo:tags-by-hand -->
who: ada-example
when: 2026-10-25T10:00:00.000Z
domains: product, platform

```

- A ticket with a tags-by-hand marker is **hand-tagged**: a tagging round never adds, removes or changes its
  domain labels. Its labels are the ones the latest marker names.
- Setting the tags by hand again writes a new marker; the latest one counts.
- **Undo:** deleting every tags-by-hand marker on the ticket hands its tags back to the next tagging round.
- The app's comment list ignores this marker, as it does every Grillo marker that is not an answer, a
  discussion or a decision.

## Codes: S, Q and v

- **Questions:** `Q<issue number>.<k>`, the `k`-th question of the ticket with that issue number. Unique
  because GitHub allocates issue numbers. A removed question's code is never reused.
- **Sources and PRD versions:** `S<n>` and `v<n>` take the next free number read from `main` after
  `git pull --ff-only`, then the file is written and pushed. A rejected push means someone wrote first: pull,
  renumber your own file to the next free number, push again. On a protected `main`, a number held by one of the
  app's own saves still waiting in a pull request counts as taken too (see "Saves to a protected main").
- **A number never changes once pushed.** PRD versions cite sources and questions by these codes.

## The claim rule

Taking a ticket is atomic (PRD section 4.3 item 6):

1. Assign yourself.
2. Re-read the assignees.
3. If another login is also assigned, the earlier `assigned` event in the issue's timeline wins, and the
   later one unassigns itself.

Agents follow the same rule through `gh`. The grilling agents of one live session share the host's login, so
each first holds the ticket on the laptop (`grillo-meeting`, "Holding a ticket in this session"): a folder inside
the project folder's `.git`, never committed and never on GitHub, whose `tab` file holds the id of the agent's tab
(`GRILLO_AGENT_ID`), so Grillo can name each tab after its ticket.

## Saves to a protected main

Every save to the Grillo folder is first a direct push to `main`. When the repository refuses it (a
protected `main`), Grillo pushes the change to a branch of its own, `grillo/save-<milliseconds>` (with `-2`,
`-3`… when two saves share a millisecond), opens a pull request into `main` titled with the save's commit message,
and tells the member which pull request holds it.

While that pull request is open, the save is **waiting**:

- **Reads see it.** Every read shows `main` with the app's waiting saves over it, so a record saved a moment
  ago can be read and changed again, and the next `S<n>` or `v<n>` skips a number a waiting save holds.
- **A save built on a waiting save joins its pull request.** When a save writes a file a waiting save holds,
  or reads one (an update of a session started a moment ago, a score of a version written a moment ago), the
  waiting save's branch is replaced by one commit holding both changes: one pull request per record, never two
  that conflict. A save that would build on two different waiting saves is refused as a conflict until one of
  them is merged. A save that touches neither opens a pull request of its own.
- **Merged or closed, it stops waiting.** Before each read and save, while any of its saves waits, the app asks
  GitHub for the repository's open pull requests (`gh pr list --state open`); a save whose pull request is no
  longer open is forgotten, and `main` (merged, or not) has the last word again.
- **Only for this run of the app.** The app remembers its waiting saves in memory. After a restart it reads
  `main` alone again, so a save then can take a number an unmerged pull request also uses; GitHub then shows
  the two pull requests in conflict, and one of them is renumbered by hand.

## Merging and reopening tickets

- **Merge:** closing a ticket as a duplicate of another, with a decision comment whose text and gist are
  `Merged into #<other issue number>`. A retry after a failure halfway finds that decision as the latest one and
  writes no second one.
- **Create:** the issue, its question codes, the sub-issue link and the blocker links are separate calls. A retry
  with the same title, kind and words finds the open issue a failure left without a link and finishes it, instead of
  creating a second one. A finished ticket with the same words stays apart: the retry makes a new one.
- **Reopen:** the ticket's lines leave the map's settled and out-of-scope lists; its decision comments stay as
  history.
- **Close again:** a ticket that has a decision comment gets the gist line of its latest decision.
- **`duplicateOf`** is the number in the ticket's latest decision, when that decision is `Merged into #<n>`,
  while the ticket is closed. An open ticket has none, nor has one decided on its own after a merge was undone.

## Recent projects

Not in GitHub: a list in the app's settings file under the key `recentProjects`, one entry per project,
`{ "project": "<owner>/<repo>", "lastOpened": "<ISO 8601>" }`, last opened first.
