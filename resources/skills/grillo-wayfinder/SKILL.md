---
name: grillo-wayfinder
description: 'Grillo''s grilling engine, adapted from wayfinder. Reads a project idea from a source file and turns it into a plan on the project''s GitHub Issues: one map issue whose destination is always a PRD, and decision tickets with numbered questions hung under it, using frontier, fog and out of scope. Every answer is checked against the map and related tickets for contradictions and records its source before it is posted; every ticket close ends with the map-done rule, which starts /grillo-prd once no ticket and no fog is left; every session first gives each PRD structure section with no settled decision a ticket or a fog line. Every other Grillo skill builds on these rules. Started by Grillo, which types /grillo-wayfinder <path to source file> once the idea is saved as source S1.'
argument-hint: "<path to source file>"
disable-model-invocation: true
---

# grillo-wayfinder

> [!NOTE]
> **Grillo's own copy of wayfinder, adapted on purpose and never synced with orion's wayfinder.** Grillo copies
> this folder into the project folder's `.claude/skills/` and writes no `CLAUDE.md` there, so every rule this skill
> needs is written here or in `references/`. Other Grillo skills point at the sections below by name.

A project idea is too large to settle in one sitting. This skill writes the plan down as issues in the project's
GitHub repository, one **map** and many small **tickets**, each holding the **questions** members answer. Members
then answer the tickets, alone or together, until every question has an answer; at that moment the PRD is written.

## Words this skill uses

- **Member**: a person on the project, known by their GitHub login. You act for the member who runs this agent: their
  login is `gh api user --jq .login`.
- **Destination**: always a PRD (product requirements document). It is never asked: the map ends when every decision
  the PRD needs is taken, and `/grillo-prd` writes it.
- **Map**: the one issue labelled `wayfinder:map`, titled `Map`. Every session starts from it.
- **Ticket**: an issue hung under the map that groups the questions of one topic.
- **Question**: one item of a ticket, with a stable code `Q<ticket issue number>.<k>`.
- **Answer**: what members give to one question, recorded as a comment that names its sources.
- **Source**: where an answer came from (a meeting, an own-time answer, pasted text, a document), kept as a file
  `.grillo/sources/S<n>.md` on the repository's default branch.
- **Fog**: questions you expect but cannot yet write precisely enough to become a ticket.
- **Out of scope**: anything beyond the PRD destination.
- **Frontier**: the tickets a session may take now: open, every blocker closed, and assigned to nobody or to the
  member.
- **Structure section**: one section of the project's PRD structure, `.grillo/structure.json`.
- **Project folder**: the clone of the project's repository the agent runs in. Its default branch is called `main`
  below, whatever its real name.

## Ground rules

1. **Decide, don't build.** A ticket ends with a decision. You never write the PRD yourself: `/grillo-prd` does.
2. **Call every issue by its title**, with the number beside it, never a bare `#<N>`.
3. **One ticket at a time.** Each answer changes the map, so the next pick is made from the changed map.
4. **Every answer has a source**, and is recorded only through
   [`references/record-answer.md`](references/record-answer.md): the contradiction check, then the source file, then
   the answer comment.
5. **A question is never answered by you.** Members answer. Ask, then wait; a guess goes on the ticket as an
   assumption.
6. **Only write down what you can see**; the rest is fog.
7. **GitHub is the single truth.** Other laptops change the map at any moment: re-read an issue just before you write
   to it, and never trust what you read earlier in the session.
8. **Release 1 runs grilling only.** Tickets of every kind are created, but only grilling agents run: research,
   prototype and task tickets are worked by members as grilling ([The four kinds of ticket](#the-four-kinds-of-ticket))
   until release 3.

## Step 0: check GitHub and the project folder (every session, before anything else)

1. Run `gh auth status` and `gh repo view --json nameWithOwner,hasIssuesEnabled,defaultBranchRef`. If `gh` is signed
   out or issues are turned off, say so in one line and stop. Never fall back to local files or another tracker.
2. Run `git pull --ff-only` in the project folder. If it is refused, say so in one line; you may still read GitHub,
   but write no file into `.grillo/` until a pull succeeds.
3. Make sure the labels exist (`gh label list --limit 200`): `wayfinder:map`, `wayfinder:grilling`,
   `wayfinder:research`, `wayfinder:prototype`, `wayfinder:task` and `domain:none`. Create a missing one with
   `gh label create <name>`; never rename or delete a label.
4. Find the map: `gh issue list --label wayfinder:map --state all --json number,title,state`. More than one map
   means the project is broken: say so and stop.

## The records

Grillo's screens and every Grillo skill read these issues, so write them exactly in this shape.

**Labels.** Grillo sees only issues carrying its labels:

| Label | On |
|---|---|
| `wayfinder:map` | The project's one map issue. |
| `wayfinder:grilling`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:task` | Each ticket, exactly one: its kind. |
| `domain:<name>` | A ticket tagged with a domain some member declared in `.grillo/members.json`. |
| `domain:none` | The visible "no domain" tag: the ticket fits nobody and is open to anyone. Never together with a `domain:<name>`. |

Tickets are created **without** domain labels: the tagging round gives them domains later.

**The map issue**, titled `Map`, labelled `wayfinder:map`. Its body holds these five sections in this order, each a
`### ` heading followed by its content; an empty section keeps its heading:

```
### Destination
A PRD for a tool-sharing app for a made-up community garden.

### Notes
The idea is source S1.

### Settled
- #2 Borrow at the shed with a key card

### Fog
- Users and roles: whether guests from other gardens may borrow

### Out of scope
- A phone app: beyond this PRD (#5)
```

- **Destination** always starts with `A PRD for`, followed by the idea in one line.
- **Settled** holds one line per ticket closed with a decision, `- #<ticket number> <gist>`, the gist of its latest
  decision. The full answer stays on the ticket; the map never lists open tickets (ask GitHub for them).
- **Fog** holds one `- ` line per item, starting with the name of the structure section it belongs to, exactly as
  `structure.json` spells it, then `: `.
- **Out of scope** holds one `- ` line per item; a ticket closed as out of scope is named in its line as `#<number>`.

**A ticket issue**: its title is the topic; its kind is its one `wayfinder:*` label; its assignee is its claim; it is
a native sub-issue of the map. Its body holds these five sections in this order:

```
### Question
How do members borrow tools?

### Why it matters
Flows: borrowing is the app's main flow.

### Assumptions
- Every member already has a garden key card

### Questions
- Q2.1 How does a member borrow a tool?
- Q2.2 (removed)
- Q2.3 How long may a member keep a tool?

### Blocked by
- #9
```

- **Why it matters** starts with the name of the structure section the answers feed, exactly as `structure.json`
  spells it, then `: ` and the reason. This is how a session tells which sections are covered.
- **Questions**, the **Q code rule**: one line per question, `- Q<ticket issue number>.<k> <text>`, `k` counting from
  1 in order. The issue number is known only once the issue exists, so create the ticket with an empty Questions
  section, then edit the body to add them. A new question takes the highest `k` plus one. A removed question keeps its
  line as `- Q<n>.<k> (removed)`, so a code is never reused; never delete or renumber a question line. A question is
  answered once an answer comment on the ticket names its code.
- **Blocked by**: one `- #<issue number>` line per blocker, and the same blocker set as GitHub's native "blocked by"
  relation. The two always agree.
- Write a body as a file **without a byte-order mark**, in a temporary folder outside the project folder, and pass it
  with `--body-file`.

**Comments** (answers, discussions, decisions) and **source files** follow
[`references/record-answer.md`](references/record-answer.md).

## Making and changing issues

Run every command from the project folder; `gh` fills `{owner}/{repo}` from it.

- **Read an issue in full:** `gh issue view <N> --json number,title,body,labels,state,assignees`, and its comments
  with their numeric ids: `gh api repos/{owner}/{repo}/issues/<N>/comments --paginate --jq '.[] | {id, user:
  .user.login, created_at, body}'`.
- **List tickets** of one kind (repeat for each of the four): `gh issue list --label wayfinder:<kind> --state all
  --limit 1000 --json number,title,state,labels,assignees`.
- **Create a ticket:** `gh issue create --title "<title>" --label wayfinder:<kind> --body-file <file>` with an empty
  Questions section; then write the questions with their codes (`gh issue edit <N> --body-file <file>`).
- **Hang it under the map** as a native sub-issue: its id is `gh api repos/{owner}/{repo}/issues/<N> --jq .id`; then
  `gh api -X POST repos/{owner}/{repo}/issues/<map>/sub_issues -F sub_issue_id=<id>`. Read it back with `gh api
  repos/{owner}/{repo}/issues/<map>/sub_issues --paginate --jq '.[].number'`.
- **Add a blocker** in both forms: the `- #<B>` line in the body, and `gh api -X POST
  repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by -F issue_id=<id of B>`. Read it back with `gh api
  repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by --jq '.[].number'`; when the two disagree, fix it before
  writing the next ticket. A ticket must exist before another can point at it, so add blockers in a second pass.
- **Edit the map:** re-read its body, change only your lines, write it with `gh issue edit <map> --body-file <file>`,
  then read it back. If your line is missing (another laptop wrote at the same moment), write it again on the fresh
  body.

## The four kinds of ticket

Each ticket carries exactly one kind label. Pick the kind by what the question needs:

- **grilling**: a conversation that turns a loose wish into a firm decision. Most tickets are this kind.
- **research**: a fact that lives outside the project (a vendor's documentation, a rule, a figure).
- **prototype**: something rough for members to react to, when the question is about how a thing looks or behaves.
- **task**: hands-on work that must be finished before a decision is possible.

**In release 1 every kind is worked as grilling.** For a research ticket, ask the member what they found and where
(the link or the document is the source); for a prototype ticket, ask what they saw and how they reacted; for a task
ticket, ask what was done and the facts later tickets need. Never put a password, token or personal detail on a
ticket: say where it is kept, never what it is.

**Grilling** is the same for every ticket: ask **one question at a time**, in plain words a newcomer would follow,
explaining any term the first time it appears. Offer clickable options (`AskUserQuestion`) with your recommendation
marked. Ask why behind every answer, name the cost of each option, and say so when you disagree. Sort out the
vocabulary as you go: when two words seem to mean one thing, or one word two things, ask.

## Ticket, fog or out of scope

- **Ticket**: you can already write the question precisely, even if a blocker means nobody can answer it yet.
- **Fog**: you cannot yet write it that precisely. Do not chop a fog line into tickets early; a settled ticket
  sharpens fog into tickets later.
- **Out of scope**: beyond the PRD destination, however clear. It never becomes a ticket. A ticket found to be out of
  scope is closed (`gh issue close <N> --reason "not planned"`, after the member's yes when another member wrote it)
  with a line under Out of scope naming `#<N>` and why; it gets no decision and no settled line.

Before creating any ticket, search the open and closed tickets (several wordings) for one that already asks it; link
or extend that one instead of writing a duplicate.

## The structure-section step (every session start)

The map is not done until every structure section can be written. At the start of every session, after Step 0:

1. Read `.grillo/structure.json`: its `sections`, each a `name` and a one-line `note`.
2. Re-read the map (Settled, Fog) and every ticket with its state and its Why it matters.
3. A section is **covered** when a ticket with a line under Settled, an open ticket, or a fog line names it (Why it
   matters or the fog line starts with the section's name and `: `).
4. Every section that is not covered gets a ticket, when you can write its question precisely, or else a fog line.
5. Tell the member in one line what you added, or nothing when every section was covered.

## Starting the map: `/grillo-wayfinder <path to source file>`

Grillo saves the member's idea as source S1 and types `/grillo-wayfinder .grillo/sources/S1.md`. The engine creates
the map, the tickets and their questions **alone**: no conversation is needed before tickets exist.

1. Run Step 0.
2. Read the source file at the given path, relative to the project folder. It holds the header lines `kind:`, `who:`,
   `when:`, `where:`, an empty line, then the idea word for word; its code is its file name (`S1`). If the file is
   missing or not in that shape, say so and stop.
3. **If the map already exists**, never create a second one: work this source into the existing map (steps 5 and 7
   against the tickets already there, with the duplicate search), then run the structure-section step and stop.
4. Read `.grillo/structure.json`.
5. **Survey wide before deep.** For every structure section, list the decisions the PRD still needs from this idea.
   Sort each into a ticket (with its questions), a fog line or out of scope. Group questions on one topic into one
   ticket, sized so one sitting can settle it; keep the topics that two tickets share as few as possible so members
   can work them side by side.
6. **Create the map**: Destination `A PRD for <the idea in one line>`, Notes (`The idea is source S1.` and anything
   every session should know, such as the words the idea uses), Settled empty, the fog and out-of-scope lines.
7. **Create every ticket** you can write, hang each under the map, then add the blockers in a second pass. Tickets
   with no open blocker form the frontier.
8. Run the structure-section step.
9. **Stop.** Settle nothing in this session. Report the map's title with its link, the frontier tickets by title, and
   how many fog lines remain. The member's next step is the tagging round on the map screen.

## Working a ticket (the engine every grilling skill follows)

`/grillo-answer`, `/grillo-meeting` and the other Grillo skills that settle tickets follow these steps.

1. Run Step 0 and the structure-section step.
2. **Pick the ticket**: the one the member or the screen named, otherwise the first ticket on the frontier.
3. **Claim it** before doing anything on it ([Claiming a ticket](#claiming-a-ticket)).
4. **Read it in full**, with its comments. Walk its open questions one at a time, in order, grilling as
   [The four kinds of ticket](#the-four-kinds-of-ticket) says. Open the full body and decision of a related ticket
   whenever you need it.
5. **Record every answer** through [`references/record-answer.md`](references/record-answer.md), the moment the member
   gives it.
6. **Drift**: answer the question at hand; what else was said may add a question to this ticket (the next `k`), a new
   ticket, a fog line or an out-of-scope line. A question the answers made pointless becomes `(removed)`.
7. **Done** (the member says so; offer it once every question is answered):
   - **Every question answered:** post the decision comment (record-answer.md, "The comments": the ticket's final
     answer, its sources, and a one-line `gist:`), close the ticket (`gh issue close <N> --reason completed`), and add
     `- #<N> <gist>` under Settled on the map. Then update the plan: create the tickets the answer raised, turn every
     fog line it made precise into a ticket and take that line off the fog, move what it placed beyond the PRD to Out
     of scope. Then apply [the map-done rule](#the-map-done-rule).
   - **Questions still open:** release the ticket (`gh issue edit <N> --remove-assignee @me`). It returns to the pool,
     unlocked, its open questions visible.
8. Report the ticket's title, the decision in one line, and what is on the frontier now.

**Merging** a ticket into another open ticket (the same question asked twice): post a decision comment whose gist and
text are both `Merged into #<other number>`, close it as a duplicate (`gh api -X PATCH
repos/{owner}/{repo}/issues/<N> -f state=closed -f state_reason=duplicate`), then apply the map-done rule. A merged
ticket gets no line under Settled.

## Claiming a ticket

Taking a ticket is atomic: two laptops must never both work one ticket. Before working any ticket, claim it for the
member with the store's claim rule, through `gh`:

1. **Re-read its assignees**: `gh issue view <N> --json assignees`. Assigned to another login: it is theirs. Say who
   holds it, write nothing on it, and take the next ticket on the frontier (or stop, when the member named this
   ticket). Already assigned to the member (they took it or were sent it): it is yours; carry on.
2. **Assign yourself**: `gh issue edit <N> --add-assignee @me`.
3. **Re-read the assignees.** If another login is also assigned, the earlier `assigned` event wins: read them oldest
   first with `gh api repos/{owner}/{repo}/issues/<N>/timeline --paginate --jq '.[] | select(.event == "assigned") |
   .assignee.login'`. When the other login's event comes first, unassign yourself (`gh issue edit <N>
   --remove-assignee @me`) and take the next ticket; otherwise the ticket is yours.

## The map-done rule

The PRD is written the moment the map is done: no open ticket and no fog. After **every ticket you close, merge into
another, or the last fog line you take off**:

1. Read the map issue (the issue labelled `wayfinder:map`) and its `### Fog` section, fresh from GitHub.
2. Read every open ticket: the open issues labelled `wayfinder:grilling`, `wayfinder:research`,
   `wayfinder:prototype` or `wayfinder:task`, every page of them.
3. No open ticket and no fog line: tell the member the map is done and run `/grillo-prd` in this same agent, following
   that skill's steps (Grillo ships it beside this one).
4. Otherwise carry on; nothing is written.

A screen's Done button only types `done` into the agent: closing or releasing the ticket, and this rule, are always
the agent's job, never left to the screen.

## Guardrails

- **Write only what these steps write**: the map, tickets and comments through `gh`, and files under `.grillo/`
  through record-answer.md. Never commit any other file, never `git add -A`, never force-push, never `--no-verify`.
- **Nothing disappears without a yes.** Closing, merging or editing a ticket another member wrote, deleting a comment,
  or changing the destination waits for the member's explicit yes.
- **Sensitive data.** Every member can read every issue and file. Never put a password, token or absolute machine
  path on them; personal details only as the member said them as part of an answer.
- **Scope does not grow quietly.** When settling a ticket turns into building the product, stop and say so.

## Reporting back

Short, one fact per line: what changed first; tickets by title; anything blocked and on whom; then the one next step.

## Mistakes to avoid

| Mistake | What goes wrong |
|---|---|
| Asking what the destination is | It is always a PRD; Grillo never asks. |
| Talking to the member before the map exists | The map and tickets are created alone, from the source. |
| Answering a question yourself | The point of a ticket is the members' own answer. Ask and wait. |
| Posting an answer before its source file is on `main` | The answer cites a code nobody can open. Follow record-answer.md in order. |
| Recording without re-reading the map | A clash with a decision taken meanwhile on another laptop goes unnoticed. |
| Reusing or renumbering a question code | PRD versions cite `Q<n>.<k>`; the trace breaks. |
| Keeping a list of open tickets in the map | It is out of date at once; GitHub's list is the real one. |
| Closing a ticket without the map-done rule | Nobody starts `/grillo-prd`, and the finished map waits for nothing. |
| Working a ticket without claiming it | Two laptops answer the same questions twice. |
