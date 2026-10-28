---
name: grillo-answer
description: 'Grillo''s own-time answering. /grillo-answer <ticket number> claims one ticket and runs a grilling chat on it in the member''s own time: one question at a time with follow-up questions, every answer and its discussion recorded with its source; at done every question answered closes the ticket with a decision and applies the map-done rule, which starts /grillo-prd once the map is done, and questions still open release the ticket to the pool, unlocked. /grillo-answer pickup turns the plain comments members wrote on tickets in GitHub''s own web or phone app into recorded answers marked via: github, whose source is the comment''s author and date, naming the member who recorded it, even on a ticket taken by or sent to someone else, and closes every ticket it leaves fully answered. Started by Grillo: the own-time screen types /grillo-answer <ticket number>, the "Pick up GitHub comments" control on ticket management types /grillo-answer pickup.'
argument-hint: "<ticket number> | pickup"
disable-model-invocation: true
---

# grillo-answer

> [!NOTE]
> **Grillo ships this folder beside `grillo-wayfinder`** in the project folder's `.claude/skills/` and writes no
> `CLAUDE.md` there. The map, the tickets, the claim rule, the grilling and the map-done rule are that skill's, and
> this skill follows them by section name: `.claude/skills/grillo-wayfinder/SKILL.md`. Every answer, discussion and
> decision is recorded only through `.claude/skills/grillo-wayfinder/references/record-answer.md`, which this file
> calls record-answer.md.

Members do not all fit in one meeting. This skill lets a member settle a ticket on their own, in a chat with this
agent, and lets any member turn the answers others wrote from their phone, as plain GitHub comments, into recorded
answers.

## Words this skill uses

- **Member**: a person on the project, known by their GitHub login and listed in `.grillo/members.json` with a `role`.
  You act for the member who runs this agent, the **runner**: their login is `gh api user --jq .login`.
- **Ticket**: an issue labelled with one of `wayfinder:grilling`, `wayfinder:research`, `wayfinder:prototype` or
  `wayfinder:task`, hung under the map (the issue labelled `wayfinder:map`).
- **Live question**: a line under the ticket's `### Questions` that is not `(removed)`. It is **answered** once an
  answer comment (`<!-- grillo:answer -->`) on the ticket names its code `Q<ticket issue number>.<k>` in `question:`.
- **Plain comment**: a comment whose first line is no `<!-- grillo:` marker, written by a member in GitHub's own web
  or phone app.
- **Waiting comment**: a plain comment no answer comment names in its `from:` line yet.
- **Now**: the moment you record, in ISO 8601 UTC with milliseconds: `date -u +%Y-%m-%dT%H:%M:%S.000Z`.
- **Project folder**: the clone of the project's repository the agent runs in. Its default branch is called `main`
  below, whatever its real name.

## Ground rules

1. **A question is never answered by you.** The runner answers in a chat; a member answers in a plain comment. Never
   fill a gap with a guess: a question nobody answered stays open.
2. **Every answer goes through record-answer.md**, in its order: the contradiction check, the source file, the answer
   comment. Never post an answer whose source is not on `main`.
3. **Words are kept word for word.** A source holds what was said or written exactly; the answer is the distilled
   decision; a discussion is the exchange exactly as it went.
4. **GitHub is the single truth.** Other laptops write at any moment: re-read a ticket and its comments just before you
   write to it.
5. **Call every ticket by its title**, with the number beside it, never a bare `#<N>`.
6. **Never edit or delete a plain comment.** It stays as its author wrote it; the answer that names it in `from:` is
   the record, and deleting that answer puts the comment back to waiting.

## The two commands

| Command | Who types it | What it does |
|---|---|---|
| `/grillo-answer <ticket number>` | The own-time screen, when the member chooses to answer a ticket with a grilling agent | [The own-time chat](#the-own-time-chat-grillo-answer-ticket-number) on that one ticket, until [done](#done-finishing-the-ticket). |
| `/grillo-answer pickup` | The "Pick up GitHub comments" control on ticket management | [The comment pickup](#the-comment-pickup-grillo-answer-pickup): every waiting comment on every open ticket becomes an answer marked `via: github`. |

`<ticket number>` is the ticket's issue number in digits with no `#` (`/grillo-answer 12`). Any other argument: say in
one line that the command takes a ticket number or `pickup`, and stop.

## The own-time chat: `/grillo-answer <ticket number>`

1. Run grillo-wayfinder's Step 0 and its structure-section step (`grillo-wayfinder`, "Step 0: check GitHub and the
   project folder" and "The structure-section step"). When the `git pull --ff-only` is refused, say so in one line and
   stop: no answer can be recorded without saving its source to `main`.
2. **Check the ticket**: `gh issue view <N> --json number,title,state,labels,assignees`. Not a ticket (no kind label,
   or the map itself): say so and stop. Closed: say so, with its settled gist when it has one, and stop; reopening is a
   screen action, never this skill's.
3. **Claim it** (`grillo-wayfinder`, "Claiming a ticket"). Held by another member: say who holds it, write nothing on
   it, and stop. Already assigned to the runner (they took it or were sent it): it is theirs; carry on.
4. **Read it in full**, with every comment and its numeric id (`grillo-wayfinder`, "Making and changing issues"). Tell
   the runner in one line which questions are answered already and which are open. Waiting comments on this ticket
   are answers someone wrote from GitHub: name them in one line, say `/grillo-answer pickup` records them, and leave
   them alone.
5. **Walk the open questions one at a time**, in order, grilling as grillo-wayfinder does (`grillo-wayfinder`, "The
   four kinds of ticket"). Ask **follow-up questions** until the answer is firm enough to build on: ask why, name the
   cost of each option, and say so when you disagree or when the answer leaves part of the question open.
6. **Record each answer the moment it is firm**, through record-answer.md:
   - Step 1, the contradiction check, exactly as written there.
   - Step 2, the source: `kind: own-time-answer`; `who:` the runner's name and role (`gh api user --jq .name`, and
     their `role` in `.grillo/members.json`); `when:` when they said it; `where:` `Grillo, own-time chat on ticket #<N>`;
     the text: the runner's own words for this answer, follow-ups included, word for word.
   - Step 3, the answer comment: `who:` the runner's login, `via:` and `from:` empty.
   - **The discussion.** The chat is how this answer was reached: when it took follow-up questions, post a
     `<!-- grillo:discussion -->` comment right after the answer, citing the same source, with `session:` empty and
     the exchange about this question word for word as its text (your questions and the runner's replies, each line
     starting with who spoke: `Agent:` or the runner's login). An answer given in one go, with no follow-up, gets the
     answer comment only.
7. **Drift**: as grillo-wayfinder says (`grillo-wayfinder`, "Working a ticket" step 6). An answer to a question the
   ticket does not hold first adds that question with the next `k`, then answers it.
8. **Once every live question is answered**, offer done in one line. The runner says done, or the screen types it:
   go to [Done](#done-finishing-the-ticket).

## Messages from Grillo's screens

While the chat runs, the own-time screen may type a protocol message: its **last line** is the control line, with
nothing else on it. Lines above it are text that was already in the input box.

| Control line | What you do |
|---|---|
| `done` | [Done](#done-finishing-the-ticket). The lines above it are not recorded. |
| `use it` | The lines above are a transcript chunk (a pasted or uploaded transcript for this ticket). Take from it the answer to the question at hand, and to any other open question of this ticket it answers, and record each through record-answer.md, with the whole chunk word for word as each answer's discussion. With no session message before it, the chunk is a `pasted-text` source written once and cited by every answer it gives: ask the runner, in one question, who spoke, when and where it was recorded, unless the chunk says so, and write the discussion with `session:` empty. An empty chunk records nothing: say nothing was heard. |
| `session: <path to session file>` | A live session is running. Every answer you record from a later `use it` cites a `meeting` source pointing at that session file, and its discussion names the file in `session:` (record-answer.md, "Step 2: the source file"). |
| `present:`, `mode:`, `skip`, `jump` | These belong to a live meeting, never to an own-time chat: say so in one line and carry on. |

A message whose last line is none of these is the runner talking to you, as always.

## Done: finishing the ticket

Re-read the ticket and every comment, fresh from GitHub, then:

- **Every live question answered:**
  1. Post the decision comment (record-answer.md, "The comments"): `who:` the runner's login, `when:` now,
     `sources:` every source code the ticket's answers cite, each once, in number order; `via:` empty in the own-time
     chat, `github` in the comment pickup; `gist:` the decision in one line; the text: the ticket's final answer.
  2. Close it: `gh issue close <N> --reason completed`.
  3. Add `- #<N> <gist>` under Settled on the map, then read it back (`grillo-wayfinder`, "Making and changing
     issues").
  4. Update the plan as grillo-wayfinder says (`grillo-wayfinder`, "Working a ticket" step 7): the tickets the answers
     raised, fog the answers made precise, what they put beyond the PRD.
  5. Apply the map-done rule (`grillo-wayfinder`, "The map-done rule"): with no open ticket and no fog line left, tell
     the runner the map is done and run `/grillo-prd` in this same agent.
- **Questions still open** (own-time chat only): post no decision. Release the ticket,
  `gh issue edit <N> --remove-assignee @me`, and read the assignees back: it returns to the pool, unlocked, with its
  open questions visible to everyone. Name the open questions by code in one line.

After done, **an own-time agent stops**: report, and take no other ticket.

## The comment pickup: `/grillo-answer pickup`

A member may answer from GitHub's web or phone app by writing a plain comment on a ticket. Any member's pickup turns
it into the recorded answer, marked `via: github`, even on a ticket taken by or sent to someone else.

1. Run grillo-wayfinder's Step 0 and its structure-section step (`grillo-wayfinder`, "Step 0: check GitHub and the
   project folder" and "The structure-section step"), so a section added to the structure mid-project has a ticket
   or a fog line before a close can make the map look done. When the `git pull --ff-only` is refused, say so in one
   line and stop: no source can be saved.
2. Read the runner's login and `.grillo/members.json`.
3. **List every open ticket**, every page, of the four kinds (`grillo-wayfinder`, "Making and changing issues"), and
   read each one's body and every comment with its numeric id, author and `created_at`. Closed tickets are left out:
   a plain comment on one is talk about a settled decision; name it in your report so a member can reopen the
   ticket if it matters.
4. **Find the waiting comments**, oldest first on each ticket. Leave alone, and name in the report, a comment whose
   author is no member in `.grillo/members.json`.
5. **Read each waiting comment against the ticket's live questions.** Decide which question or questions it answers.
   It may name a code (`Q3.1`) or not. A comment that answers none of them (a note, a question back, "I will check")
   stays waiting: write nothing. When you cannot tell which question it answers, ask the runner with clickable options
   (`AskUserQuestion`); never guess.
6. **Record each answer through record-answer.md**, re-reading the ticket's comments first: when an answer naming this
   comment's id in `from:` appeared meanwhile (another laptop picked it up), skip it.
   - Step 1, the contradiction check. The comment's author is not in this chat, so on a clash tell the runner what
     clashes and ask with clickable options: **the comment stands** (record it, then create the `Revisit:` ticket as
     record-answer.md says), or **leave it waiting** for its author (record nothing).
   - Step 2, the source, written once per comment however many questions it answers: `kind: own-time-answer`; `who:`
     the comment author's login; `when:` the comment's `created_at`, with milliseconds (`2026-10-24T12:00:00Z` is
     written `2026-10-24T12:00:00.000Z`); `where:` `GitHub comment <id> on ticket #<N>`; the text: the comment's body
     word for word. A source in `.grillo/sources/` whose `where:` already names this comment is cited instead of
     written again.
   - Step 3, one answer comment per question: `who:` the runner's login (the member who recorded it), `when:` now,
     `sources:` that source's code, `via: github`, `question:` its code, `from:` the comment's id; the text: the
     answer distilled from the comment, never more than it says. No discussion: a picked-up answer gets the answer
     comment only.
7. **Never claim and never unassign.** The pickup writes answers on tickets whoever holds them; the assignee stays
   exactly as it was.
8. **Done, for each ticket that got an answer in this run**: re-read it. Every live question answered: run
   [Done](#done-finishing-the-ticket) for it, with the decision's `via: github`; the ticket closes and the map-done
   rule runs. Questions still open: leave the ticket as it is, still held by whoever held it.

A source and an answer turned from a member's GitHub comment, recorded by another member:

```
kind: own-time-answer
who: cleo-example
when: 2026-10-24T12:00:00.000Z
where: GitHub comment 3001 on ticket #3

Only the rider who booked, or a volunteer on shift. Nobody else.
```

```
<!-- grillo:answer -->
who: ada-example
when: 2026-10-24T16:01:00.000Z
sources: S4
via: github
question: Q3.1
from: 3001

Only the rider who booked the slot, or a volunteer on shift, may cancel a booking.
```

Together they say "cleo-example, via GitHub, 2026-10-24" (the source's `who:` and `when:`, the answer's `via:`), and
the answer's `who:` names ada-example as the member who recorded it. **Undo** is deleting the answer comment: the
plain comment waits again for the next pickup. When that pickup also closed the ticket, a member also reopens it
(on the map screen), which takes its Settled line off; the pickup leaves closed tickets out, so until then the comment
does not wait again.

## Guardrails

- **Write only what these steps write**: answer, discussion and decision comments, closes and releases, the map's
  Settled lines, the plan changes grillo-wayfinder's steps make, and source files under `.grillo/sources/` through
  record-answer.md. Never commit any other file, never `git add -A`, never force-push, never `--no-verify`.
- **Nothing disappears without a yes.** Deleting a comment, closing a ticket as out of scope or merging it waits for
  the runner's explicit yes.
- **Sensitive data.** Every member can read every issue and file. Never put a password, token or absolute machine
  path on them; personal details only as a member said them as part of an answer.

## Reporting back

Short, one fact per line, tickets by title:

1. **Own-time chat:** the questions answered in this chat, then the outcome: closed with its gist, or released with
   its open questions; then whether the map is done.
2. **Pickup:** each comment turned into an answer, with its author and the question it answered; each ticket closed,
   with its gist; the comments left waiting and why; whether the map is done.

## Mistakes to avoid

| Mistake | What goes wrong |
|---|---|
| Recording an answer the runner did not give | The PRD traces a decision to a person who never took it. |
| Posting the answer before its source is on `main` | The answer cites a code nobody can open. |
| `who:` on a picked-up answer set to the comment's author | Grillo can no longer say who recorded it; the author is the source's `who:`. |
| Summarising the comment into the source | The trace back to the member's own words is lost. |
| Editing or deleting the plain comment | Its author's words disappear, and undo has nothing to go back to. |
| Unassigning a ticket during pickup | A member's claim is taken away behind their back. |
| Releasing a ticket with every question answered | The map never completes and `/grillo-prd` never starts. |
| Closing without the map-done rule | The finished map waits for a PRD nobody writes. |
| Working a ticket another member holds in the own-time chat | Two members answer the same questions at once. |
