---
name: grillo-research
description: 'Grillo''s research agent (release 3). /grillo-research <ticket number> claims one research ticket (labelled wayfinder:research) and works it as wayfinder works research: alone, one question at a time, reading primary sources only (official documentation, the rule''s own text, a vendor''s own pages, the project''s files) and never filling a gap from memory. Each finding is recorded as an answer through the grilling engine''s record-answer reference: the contradiction check, then every document it rests on saved as a source with its title, link and the passage word for word, then the answer comment saying how sure it is and what it could not find out. With every question answered it closes the ticket with a decision and applies the map-done rule, which starts /grillo-prd once the map is done; a question no primary source answers stays open and the ticket is released to the pool. Started by Grillo: a launch from a research ticket on ticket management types /grillo-research <ticket number>.'
argument-hint: "<ticket number>"
disable-model-invocation: true
---

# grillo-research

> [!NOTE]
> **Grillo ships this folder beside `grillo-wayfinder`** in the project folder's `.claude/skills/` and writes no
> `CLAUDE.md` there. The map, the tickets, the claim rule and the map-done rule are that skill's, and this skill
> follows them by section name: `.claude/skills/grillo-wayfinder/SKILL.md`. Every answer and decision is recorded
> only through `.claude/skills/grillo-wayfinder/references/record-answer.md`, which this file calls
> record-answer.md.

A research ticket asks for a fact that lives outside the project: what a vendor's documentation says, a rule, a
figure. This agent finds it alone, from primary sources, and records each finding with the documents it rests on, so
the PRD can trace every fact to where it was read.

## Words this skill uses

- **Member**: a person on the project, known by their GitHub login and listed in `.grillo/members.json` with a `role`.
  You act for the member who runs this agent, the **runner**: their login is `gh api user --jq .login`.
- **Research ticket**: an issue labelled `wayfinder:research`, hung under the map (the issue labelled
  `wayfinder:map`).
- **Live question**: a line under the ticket's `### Questions` that is not `(removed)`. It is **answered** once an
  answer comment (`<!-- grillo:answer -->`) on the ticket names its code `Q<ticket issue number>.<k>` in `question:`.
- **Primary source**: the thing itself, read now: the official documentation, the text of the rule, the vendor's own
  pages, the dependency's own source code, the project's own files. Never a summary of it on another site, and never
  what you remember.
- **Now**: the moment you record, in ISO 8601 UTC with milliseconds: `date -u +%Y-%m-%dT%H:%M:%S.000Z`.
- **Project folder**: the clone of the project's repository the agent runs in. Its default branch is called `main`
  below, whatever its real name.

## Ground rules

1. **Primary sources only, never from memory.** Every claim in an answer rests on a document you read in this
   session, with its link. A question no primary source answers stays open: never fill the gap with a guess.
2. **Every answer goes through record-answer.md**, in its order: the contradiction check, the source file, the answer
   comment. Never post an answer whose source is not on `main`.
3. **Words are kept word for word.** A source holds the passage exactly as the document has it; the answer is the
   finding drawn from it, never more than the passage says.
4. **GitHub is the single truth.** Other laptops write at any moment: re-read the ticket and its comments just before
   you write to it.
5. **Call every ticket by its title**, with the number beside it, never a bare `#<N>`.
6. **One ticket.** This agent works the ticket it was started on, then stops.

## The command: `/grillo-research <ticket number>`

`<ticket number>` is the ticket's issue number in digits with no `#` (`/grillo-research 12`). Any other argument: say
in one line that the command takes a ticket number, and stop.

1. Run grillo-wayfinder's Step 0 and its structure-section step (`grillo-wayfinder`, "Step 0: check GitHub and the
   project folder" and "The structure-section step"). When the `git pull --ff-only` is refused, say so in one line and
   stop: no source can be saved to `main`.
2. **Check the ticket**: `gh issue view <N> --json number,title,state,labels,assignees`.
   - Not a ticket (no `wayfinder:*` kind label, or the map itself): say so and stop.
   - Another kind: say so, name the command that works it, and stop. A grilling ticket: `/grillo-answer <N>`; a
     prototype ticket: `/grillo-prototype <N>`; a task ticket: `/grillo-task <N>`.
   - Closed: say so, with its settled gist when it has one, and stop; reopening is a screen action, never this
     skill's.
3. **Claim it** (`grillo-wayfinder`, "Claiming a ticket"). Held by another member: say who holds it, write nothing on
   it, and stop. Already assigned to the runner: it is theirs; carry on.
4. **Read it in full**, with every comment and its numeric id (`grillo-wayfinder`, "Making and changing issues"), and
   the decisions of the tickets it is blocked by. Tell the runner in one line which questions are answered already
   and which are open. A plain comment no answer names yet is an answer a member wrote from GitHub: name it in one
   line, say `/grillo-answer pickup` records it, and leave it alone.
5. **Research the open questions one at a time**, in order: [Researching one question](#researching-one-question).
6. **Record each finding the moment it is firm**: [Recording a finding](#recording-a-finding).
7. **Drift**: as grillo-wayfinder says (`grillo-wayfinder`, "Working a ticket" step 6). A fact the reading turned up
   that the ticket does not ask about may add a question (the next `k`), a new ticket or a fog line.
8. **Once every open question is researched**, tell the runner in one line what you found and what stays open, then
   go to [Done](#done-finishing-the-ticket) yourself. A research ticket needs nobody's approval to close.

## Researching one question

1. **Write the question in one sentence**, in the runner's words, and say where you will look.
2. **Read primary sources only**, now: fetch the page or open the file, never answer from what you remember. Prefer
   the newest version of a document, and note its date. A page that needs a sign-in, a payment or a personal account
   is out of reach: say so and look elsewhere; never sign up, buy, post or change anything outside the project folder
   and its GitHub issues.
3. **Keep the passage** each claim rests on, word for word, with the document's title, link, author and date.
4. **Finish with the finding**: the answer to the question, how sure you are (the document says so in so many words,
   or you drew it from several passages), and what you could not find out.
5. **No primary source answers it**: record nothing. Tell the runner what you searched and why it was not enough, and
   ask once whether they know a document to read. A document they point to is read like any other. Their own
   knowledge, given in the chat, is their own words: record it as record-answer.md says for the member in a chat
   (`kind: own-time-answer`, `where:` `Grillo, own-time chat on ticket #<N>`). With neither, the question stays open.

## Recording a finding

Every finding goes through record-answer.md, in its order:

- **Step 1, the contradiction check** (record-answer.md, "Step 1: the contradiction check"), exactly as written
  there. A finding that clashes with a settled decision is still a fact: tell the runner what clashes, naming the
  other ticket by title and quoting its decision, and let them settle it with clickable options (`AskUserQuestion`)
  as that step says.
- **Step 2, the source** (record-answer.md, "Step 2: the source file"): one source per document, written once however
  many findings cite it: `kind: document`; `who:` its author, or the organisation that publishes it; `when:` its date
  as the document gives it (the day at `T00:00:00.000Z`), or the moment you read it when it gives none; `where:` its
  title, then a comma and its link; the text: the passage word for word. A source in `.grillo/sources/` whose `where:`
  names the same link and whose text holds the same passage is cited instead of written again.
- **Step 3, the answer comment** (record-answer.md, "Step 3: the answer comment"): `who:` the runner's login, `when:`
  now, `sources:` every document the finding rests on, `via:` and `from:` empty; the text: the finding, how sure you
  are, and what you could not find out. No discussion: the reading was done alone, so nothing was talked through.

A document source and the finding that rests on it:

```
kind: document
who: Example Calendar Company
when: 2026-09-30T00:00:00.000Z
where: Example Calendar developer guide, Reading a shared calendar, https://calendar.example.com/docs/shared-calendars

Any app may read a shared calendar on the free plan. Writing to a shared calendar needs the Team plan.
```

```
<!-- grillo:answer -->
who: ada-example
when: 2026-10-26T10:12:00.000Z
sources: S2
via:
question: Q2.1
from:

Yes for reading: any app may read a shared calendar on the free plan. Writing bookings into it needs the paid Team plan. Sure: the guide says both in so many words. Not found: whether the free plan limits how many apps may read it.
```

## Messages from Grillo's screens

While the agent runs, a screen may type a protocol message: its **last line** is the control line, with nothing else
on it. Lines above it are text that was already in the input box.

| Control line | What you do |
|---|---|
| `use it` | The lines above are a transcript chunk. Take from it what it says about this ticket's open questions, and record each finding it gives through record-answer.md, with the whole chunk word for word as each answer's discussion. After a session message the chunk is a `meeting` source pointing at that session file; with none it is a `pasted-text` source written once and cited by every answer it gives: ask the runner, in one question, who spoke, when and where it was recorded, unless the chunk says so, and write the discussion with `session:` empty. An empty chunk records nothing: say nothing was heard. |
| `session: <path to session file>` | A live session is running. Every answer you record from a later `use it` cites a `meeting` source pointing at that session file, and its discussion names the file in `session:` (record-answer.md, "Step 2: the source file"). |
| `done` | No screen types it to this agent; a runner who types it wants to stop now: go to [Done](#done-finishing-the-ticket) with what is recorded. The lines above it are not recorded. |
| `present:`, `mode:`, `skip`, `jump` | These belong to a live meeting, never to a research agent: say so in one line and carry on. |

A message whose last line is none of these is the runner talking to you, as always.

## Done: finishing the ticket

Re-read the ticket and every comment, fresh from GitHub, then:

- **Every live question answered:**
  1. Post the decision comment (record-answer.md, "The comments"): `who:` the runner's login, `when:` now,
     `sources:` every source code the ticket's answers cite, each once, in number order; `via:` empty; `gist:` the
     finding in one line; the text: the ticket's final answer.
  2. Close it: `gh issue close <N> --reason completed`.
  3. Add `- #<N> <gist>` under Settled on the map, then read it back (`grillo-wayfinder`, "Making and changing
     issues").
  4. Update the plan as grillo-wayfinder says (`grillo-wayfinder`, "Working a ticket" step 7): the tickets the
     findings raised, fog they made precise, what they put beyond the PRD.
  5. Apply the map-done rule (`grillo-wayfinder`, "The map-done rule"): with no open ticket and no fog line left, tell
     the runner the map is done and run `/grillo-prd` in this same agent.
- **Questions still open:** post no decision. Release the ticket, `gh issue edit <N> --remove-assignee @me`, and read
  the assignees back: it returns to the pool, unlocked, with its open questions visible to everyone. Name the open
  questions by code in one line, with what you searched for each.
- **Either way**, then let go of its hold (`grillo-wayfinder`, "Holding a ticket on this laptop"), so another
  grilling agent on this laptop may take it; a ticket you never claimed here has no hold of yours to let go of.

After done, **the agent stops**: report, and take no other ticket.

## Guardrails

- **Write only what these steps write**: answer, discussion and decision comments, the close or the release, the
  map's Settled line, the plan changes grillo-wayfinder's steps make, and source files under `.grillo/sources/`
  through record-answer.md. Never commit any other file, never `git add -A`, never force-push, never `--no-verify`.
- **Research only reads.** Never sign up, buy, post, send or change anything outside the project folder and its
  GitHub issues.
- **Nothing disappears without a yes.** Deleting a comment, closing a ticket as out of scope or merging it waits for
  the runner's explicit yes.
- **Sensitive data.** Every member can read every issue and file. Never put a password, token, personal detail or
  absolute machine path on them, and never quote a page that only a sign-in shows.

## Reporting back

Short, one fact per line, tickets by title: each question with its finding and the documents it rests on, then the
outcome (closed with its gist, or released with its open questions), then whether the map is done.

## Mistakes to avoid

| Mistake | What goes wrong |
|---|---|
| Answering from memory | The PRD cites a fact nobody can check, and it may be out of date. |
| Summarising the document into the source | The trace back to the document's own words is lost. |
| A `where:` with no link | Nobody can open the document the finding rests on. |
| Posting the answer before its source is on `main` | The answer cites a code nobody can open. |
| Filling an unanswered question with a guess | A guess becomes a decision. It stays open, and the ticket is released. |
| Closing without the map-done rule | The finished map waits for a PRD nobody writes. |
| Working a ticket another member holds | Two members research the same questions at once. |
