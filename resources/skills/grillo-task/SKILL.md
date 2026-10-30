---
name: grillo-task
description: 'Grillo''s task agent (release 3). /grillo-task <ticket number> claims one task ticket (labelled wayfinder:task) and works it as wayfinder works tasks: the hands-on work that must be finished before a decision is possible, done by the agent alone when it can and otherwise given to the member as a numbered list of exact steps, then waited for. Each fact the work produces is recorded as an answer through the grilling engine''s record-answer reference: the contradiction check, then the source (the agent''s own work record, or the member''s report in their own words), then the answer comment, never a password or token. With every question answered it closes the ticket with a decision and applies the map-done rule, which starts /grillo-prd once the map is done; work still waiting on someone releases the ticket to the pool. Started by Grillo: a launch from a task ticket on ticket management types /grillo-task <ticket number>.'
argument-hint: "<ticket number>"
disable-model-invocation: true
---

# grillo-task

> [!NOTE]
> **Grillo ships this folder beside `grillo-wayfinder`** in the project folder's `.claude/skills/` and writes no
> `CLAUDE.md` there. The map, the tickets, the claim rule and the map-done rule are that skill's, and this skill
> follows them by section name: `.claude/skills/grillo-wayfinder/SKILL.md`. Every answer, discussion and decision is
> recorded only through `.claude/skills/grillo-wayfinder/references/record-answer.md`, which this file calls
> record-answer.md.

Some decisions wait on work: a trial account to test a vendor's limits, read access to a store of records, a sample
exported to look at its fields. A task ticket names that work. This agent does it, alone when it can and with the
member when it cannot, and records every fact later tickets need. It is the only kind that does work instead of
deciding, and the work exists only to unblock a decision, never to build the product.

## Words this skill uses

- **Member**: a person on the project, known by their GitHub login and listed in `.grillo/members.json` with a `role`.
  You act for the member who runs this agent, the **runner**: their login is `gh api user --jq .login`.
- **Task ticket**: an issue labelled `wayfinder:task`, hung under the map (the issue labelled `wayfinder:map`).
- **Live question**: a line under the ticket's `### Questions` that is not `(removed)`. It is **answered** once an
  answer comment (`<!-- grillo:answer -->`) on the ticket names its code `Q<ticket issue number>.<k>` in `question:`.
  Each question of a task ticket names a fact the work must produce.
- **Work record**: what you did and what it returned, written as a source when you did the work alone.
- **Scratch folder**: a new empty folder outside the project folder, made with `mktemp -d`.
- **Now**: the moment you record, in ISO 8601 UTC with milliseconds: `date -u +%Y-%m-%dT%H:%M:%S.000Z`.
- **Project folder**: the clone of the project's repository the agent runs in. Its default branch is called `main`
  below, whatever its real name.

## Ground rules

1. **Only the work the ticket needs.** Do what its questions need to be answered, and nothing more. When the work
   starts turning into building the product, stop and say so.
2. **Ask before anything you cannot take back.** A step that costs money, creates an account, sends something to a
   person, or writes to a system outside the project folder and its GitHub issues waits for the runner's explicit yes.
3. **Every answer goes through record-answer.md**, in its order: the contradiction check, the source file, the answer
   comment. Never post an answer whose source is not on `main`.
4. **Never a secret on a ticket or in a source.** Say where a password, token or key is kept, never what it is.
5. **GitHub is the single truth.** Other laptops write at any moment: re-read the ticket and its comments just before
   you write to it.
6. **Call every ticket by its title**, with the number beside it, never a bare `#<N>`.

## The command: `/grillo-task <ticket number>`

`<ticket number>` is the ticket's issue number in digits with no `#` (`/grillo-task 12`). Any other argument: say in
one line that the command takes a ticket number, and stop.

1. Run grillo-wayfinder's Step 0 and its structure-section step (`grillo-wayfinder`, "Step 0: check GitHub and the
   project folder" and "The structure-section step"). When the `git pull --ff-only` is refused, say so in one line and
   stop: no answer can be recorded without saving its source to `main`.
2. **Check the ticket**: `gh issue view <N> --json number,title,state,labels,assignees`.
   - Not a ticket (no `wayfinder:*` kind label, or the map itself): say so and stop.
   - Another kind: say so, name the command that works it, and stop. A grilling ticket: `/grillo-answer <N>`; a
     research ticket: `/grillo-research <N>`; a prototype ticket: `/grillo-prototype <N>`.
   - Closed: say so, with its settled gist when it has one, and stop; reopening is a screen action, never this
     skill's.
3. **Claim it** (`grillo-wayfinder`, "Claiming a ticket"). Held by another member: say who holds it, write nothing on
   it, and stop. Already assigned to the runner: it is theirs; carry on.
4. **Read it in full**, with every comment and its numeric id (`grillo-wayfinder`, "Making and changing issues"), and
   the decisions of the tickets it is blocked by. Tell the runner in one line which questions are answered already
   and which are open. A plain comment no answer names yet is an answer a member wrote from GitHub: name it in one
   line, say `/grillo-answer pickup` records it, and leave it alone.
5. **Plan the work**: [Doing the work](#doing-the-work).
6. **Record each fact the moment the work gives it**: [Recording a fact](#recording-a-fact).
7. **Drift**: as grillo-wayfinder says (`grillo-wayfinder`, "Working a ticket" step 6). A fact the work turned up that
   the ticket does not ask about may add a question (the next `k`), a new ticket or a fog line.
8. **Once every live question is answered**, or the work waits on someone who is not here, offer done in one line.
   The runner says done: go to [Done](#done-finishing-the-ticket).

## Doing the work

1. **Show the plan first**: a numbered list, one step per line, saying for each whether you do it or the runner
   does, and which question it answers. Wait for the runner's go.
2. **Do alone what you can**: commands, scripts, reading files the runner gives you. Work in a scratch folder
   (`mktemp -d`), never in the project folder, and commit nothing. Ask before each step ground rule 2 names.
3. **Give the runner what you cannot do**: a numbered list of exact steps (where to click, what to type), with made-up
   example values where they help, then wait for their report. Ask follow-up questions until it holds the fact the
   question needs.
4. **Work that waits on someone else** (an access request, a colleague's answer): say who it waits on and what they
   must do, and record what is already known. The ticket is released at done, so whoever finishes the work can run
   this command again.

## Recording a fact

Every answer goes through record-answer.md, in its order:

- **Step 1, the contradiction check** (record-answer.md, "Step 1: the contradiction check"), exactly as written there.
- **Step 2, the source** (record-answer.md, "Step 2: the source file"), by who did the work:
  - **Work you did alone**: the work record. `kind: document`; `who:` the runner's name and role (`gh api user --jq
    .name`, and their `role` in `.grillo/members.json`), since you worked for them; `when:` the moment the work
    finished; `where:` `Grillo, task agent on ticket #<N>`; the text: what you ran and what it returned, word for
    word, with any secret and any absolute machine path left out.
  - **Work the runner did**: their report in their own words. `kind: own-time-answer`; `who:` the runner's name and
    role; `when:` when they said it; `where:` `Grillo, own-time chat on ticket #<N>`; the text: their report,
    follow-ups included, word for word.
- **Step 3, the answer comment** (record-answer.md, "Step 3: the answer comment"): `who:` the runner's login, `via:`
  and `from:` empty; the text: the fact, and where anything the work made is kept (an account, a file, an address),
  never the secret itself.
- **The discussion.** When the runner's report took follow-up questions, post a `<!-- grillo:discussion -->` comment
  right after the answer, citing the same source, with `session:` empty and the exchange about this question word for
  word as its text, each line starting with who spoke (`Agent:` or the runner's login). Work you did alone gets the
  answer comment only.

A work record and the fact that rests on it:

```
kind: document
who: Ada Example, product
when: 2026-10-27T10:20:00.000Z
where: Grillo, task agent on ticket #2

Counted the rows of the September export the runner saved, signups-september.csv, below its header line: 212.
```

```
<!-- grillo:answer -->
who: ada-example
when: 2026-10-27T10:22:00.000Z
sources: S3
via:
question: Q2.2
from:

The sheet held 212 sign-ups in September. The export stays on the runner's laptop and is not shared.
```

## Messages from Grillo's screens

While the agent runs, a screen may type a protocol message: its **last line** is the control line, with nothing else
on it. Lines above it are text that was already in the input box.

| Control line | What you do |
|---|---|
| `use it` | The lines above are a transcript chunk: members talking about the work. Take from it the facts it gives for this ticket's open questions, and record each through record-answer.md, with the whole chunk word for word as each answer's discussion. After a session message the chunk is a `meeting` source pointing at that session file; with none it is a `pasted-text` source written once and cited by every answer it gives: ask the runner, in one question, who spoke, when and where it was recorded, unless the chunk says so, and write the discussion with `session:` empty. An empty chunk records nothing: say nothing was heard. |
| `session: <path to session file>` | A live session is running. Every answer you record from a later `use it` cites a `meeting` source pointing at that session file, and its discussion names the file in `session:` (record-answer.md, "Step 2: the source file"). |
| `done` | No screen types it to this agent; a runner who types it wants to stop now: go to [Done](#done-finishing-the-ticket). The lines above it are not recorded. |
| `present:`, `mode:`, `skip`, `jump` | These belong to a live meeting, never to a task agent: say so in one line and carry on. |

A message whose last line is none of these is the runner talking to you, as always.

## Done: finishing the ticket

Re-read the ticket and every comment, fresh from GitHub, then:

- **Every live question answered:**
  1. Post the decision comment (record-answer.md, "The comments"): `who:` the runner's login, `when:` now,
     `sources:` every source code the ticket's answers cite, each once, in number order; `via:` empty; `gist:` the
     outcome in one line; the text: the work carried out and every fact later tickets need.
  2. Close it: `gh issue close <N> --reason completed`.
  3. Add `- #<N> <gist>` under Settled on the map, then read it back (`grillo-wayfinder`, "Making and changing
     issues").
  4. Update the plan as grillo-wayfinder says (`grillo-wayfinder`, "Working a ticket" step 7): the tickets the facts
     raised, fog they made precise, what they put beyond the PRD.
  5. Apply the map-done rule (`grillo-wayfinder`, "The map-done rule"): with no open ticket and no fog line left, tell
     the runner the map is done and run `/grillo-prd` in this same agent.
- **Questions still open:** post no decision. Release the ticket, `gh issue edit <N> --remove-assignee @me`, and read
  the assignees back: it returns to the pool, unlocked, with its open questions visible to everyone. Name the open
  questions by code in one line, with what each still waits on.
- **Either way**, then let go of its hold (`grillo-wayfinder`, "Holding a ticket on this laptop"), so another
  grilling agent on this laptop may take it; a ticket you never claimed here has no hold of yours to let go of.

After done, **the agent stops**: report, and take no other ticket.

## Guardrails

- **Write only what these steps write**: answer, discussion and decision comments, the close or the release, the
  map's Settled line, the plan changes grillo-wayfinder's steps make, and source files under `.grillo/sources/`
  through record-answer.md. The work happens in a scratch folder. Never commit any other file, never `git add -A`,
  never force-push, never `--no-verify`.
- **Nothing disappears without a yes.** Deleting a comment, closing a ticket as out of scope or merging it waits for
  the runner's explicit yes.
- **Sensitive data.** Every member can read every issue and file. Never put a password, token, key, personal detail
  or absolute machine path on them: say where a secret is kept, never what it is.

## Reporting back

Short, one fact per line, tickets by title: the work carried out and who did each step, each question with its fact,
then the outcome (closed with its gist, or released with what it waits on), then whether the map is done.

## Mistakes to avoid

| Mistake | What goes wrong |
|---|---|
| Starting before the runner saw the plan | Work they did not want is done on their behalf. |
| Creating an account or spending money without a yes | It cannot be taken back. |
| Writing a password or token on the ticket | Every member, and anyone the repository is shared with later, can read it. |
| Working in the project folder | The work shows up as a change, and may be committed with a source. |
| Posting the answer before its source is on `main` | The answer cites a code nobody can open. |
| Keeping the ticket while the work waits on someone else | Nobody else can pick it up. Release it at done. |
| Closing without the map-done rule | The finished map waits for a PRD nobody writes. |
