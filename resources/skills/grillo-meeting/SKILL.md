---
name: grillo-meeting
description: 'Grillo''s live grilling session. Driven by the meeting controls on the host''s screen, which type protocol messages into this agent (present, session, mode, use it, skip, jump, done): picks the next unblocked ticket whose domains match someone present (domain:none counts as everyone''s), walks its questions one at a time, records a typed answer in Type mode, and in Listen mode distils the answer from the transcript chunk at "use it" and keeps the whole talk word for word as the question''s discussion, linked to the session file. Every answer cites a meeting source naming the session, its moment and the members present. Drift becomes new questions or tickets, as wayfinder does; every close ends with the map-done rule. Started by Grillo, which types /grillo-meeting when the host starts a live session.'
disable-model-invocation: true
---

# grillo-meeting

> [!NOTE]
> **Grillo ships this folder beside `grillo-wayfinder`** in the project folder's `.claude/skills/` and writes no
> `CLAUDE.md` there. The map, the tickets, the claim rule, drift and the map-done rule are that skill's, and this
> skill follows them by section name: `.claude/skills/grillo-wayfinder/SKILL.md`, and
> `.claude/skills/grillo-wayfinder/references/record-answer.md` for every answer. Everything that belongs to a live
> session alone is written here.

In a live session the members settle tickets together, in a room or on a call. The **host** shares their screen and
holds the controls; the controls talk to you only by typing **protocol messages** into your input box. You pick the
tickets, ask the questions one at a time, and record what the room answers.

`/grillo-meeting` takes no argument. Everything after it arrives as protocol messages, described in
[Messages from the meeting screen](#messages-from-the-meeting-screen).

## Words this skill uses

- **Member**: a person on the project, known by their GitHub login. You act for the member who runs this agent, the
  host or a present member who opened another grilling agent: their login is `gh api user --jq .login`.
- **Present members**: the logins of the latest `present:` message. Presence is used only to pick tickets.
- **Session file**: `.grillo/sessions/<date>-<time>.md`, named by the moment the session started, written by Grillo.
  Its header lines are `date:`, `present:`, `consent-by:` and `consent-at:`, then the whole transcript as spoken. You
  read it; you never write it.
- **Mode**: how the room answers the question at hand, `listen` or `type`. It holds until the next `mode:` message.
- **Ticket at hand** and **question at hand**: the ticket you claimed and are walking, and its open question you
  asked last.
- **Talk**: transcript lines that reached your input box about the question at hand. The **chunk** is the talk in
  the `use it` message itself; the **kept talk** is talk that arrived earlier above another control line.
- **Domain label**: `domain:<name>` for a domain some member declares in `.grillo/members.json`, or `domain:none`,
  the visible "no domain" tag: the ticket fits nobody and is open to anyone.
- **Frontier**: the tickets you may take now: open, every blocker closed, and assigned to nobody or to the member
  (`grillo-wayfinder`, "Words this skill uses").

## Ground rules

1. **The screen drives.** The host's controls arrive as protocol messages; follow each exactly as
   [Messages from the meeting screen](#messages-from-the-meeting-screen) says, in the order they arrive.
2. **Members answer, never you.** You distil what the room said; a guess goes on the ticket as an assumption.
3. **Every answer goes through `.claude/skills/grillo-wayfinder/references/record-answer.md`**: the contradiction
   check, then the source file, then the answer comment, then the discussion when there is one.
4. **One ticket at a time, one question at a time**, in the ticket's question order.
5. **Word for word.** A source and a discussion hold the talk exactly as it reached you: never tidy, shorten or
   reorder it, and never add speaker names (the transcript has none).
6. **GitHub is the single truth.** Other laptops work tickets during the meeting: re-read a ticket just before you
   write to it.
7. **Call every ticket by its title**, with the number beside it, never a bare `#<N>`.

## Starting: `/grillo-meeting`

1. Run grillo-wayfinder's Step 0 (`grillo-wayfinder`, "Step 0: check GitHub and the project folder"), then its
   structure-section step (`grillo-wayfinder`, "The structure-section step").
2. Read `.grillo/members.json`: each member's `login`, `role` and `domains`.
3. Say in one line that you are ready, and wait. Grillo types a `present:` and a `mode:` message next; until a
   presence message names someone, pick nothing.

## Messages from the meeting screen

**How a message is built.** A protocol message is one message whose **last line** is the control line: exactly one of
the texts below, alone on its line (spaces around it are ignored). Keywords and mode words are lowercase. Compare a
login with `members.json` without regard to case. Any lines above the control line are transcript that was already in
the input box. A message whose last line is no control line is a member talking to you, as always.

**A value you cannot use** (a login that is not a member, a ticket that is not open, a mode other than `listen` or
`type`, a session path not shaped `.grillo/sessions/<date>-<time>.md`) changes nothing: say what was wrong in one
line and carry on.

| Control line | What you do |
|---|---|
| `present: <logins>` | The present members are now exactly these logins, separated by `, `; the list replaces the last one. The change applies from the next ticket you pick: the question at hand goes on. With no ticket at hand, [pick the next ticket](#picking-the-next-ticket). With an empty list (`present:`), pick nothing and wait for the next presence message. |
| `session: <path to session file>` | Remember the path. From now on every answer cites a meeting source naming this session, and every discussion names this file in its `session:` line ([Recording an answer](#recording-an-answer)). |
| `mode: listen` | From the question at hand on, wait for `use it`: the room talks, and the host presses "Use it" when the talk holds the answer. |
| `mode: type` | From the question at hand on, the member's next plain message is the answer to the question at hand, recorded with no discussion. |
| `use it` | The lines above it are the chunk. With the kept talk before it, it is the talk about the question at hand: [record it from the talk](#recording-an-answer). An empty chunk records nothing: say nothing was heard. |
| `skip` | Leave the question at hand unanswered and ask the ticket's next open question. After its last one, [leave the ticket](#leaving-a-ticket) and pick the next ticket. |
| `jump <ticket number>` | Re-read that ticket. Closed, not a Grillo ticket (no `wayfinder:grilling`, `wayfinder:research`, `wayfinder:prototype` or `wayfinder:task` label), or assigned to another login: refuse in one line, saying who holds it, and the ticket at hand goes on. Otherwise [leave the ticket at hand](#leaving-a-ticket), claim that one and walk its open questions, whatever its domains; an open blocker is named in one line and does not stop the jump. |
| `done` | [Leave the ticket at hand](#leaving-a-ticket), then pick the next ticket. |

- **Transcript above `present:`, `session:` or `mode:`** is talk about the question at hand: keep it for that
  question's next `use it`.
- **Transcript above `skip`, `jump` or `done`** is never recorded: it stays in the session transcript only. Drop the
  kept talk too.
- **Kept talk belongs to one question.** When the question at hand changes, drop it.
- In Type mode the screen writes no transcript into your box. A `use it` that still arrives is handled as above.

## Picking the next ticket

1. Re-read every open ticket from GitHub: the open issues labelled `wayfinder:grilling`, `wayfinder:research`,
   `wayfinder:prototype` or `wayfinder:task`, every page, with their labels, assignees and blockers.
2. Keep the frontier tickets whose domains **match someone present**: a `domain:<name>` that a present member
   declares in `members.json`, or `domain:none`, which counts as everyone's. A ticket with no domain label yet (the
   tagging round has not reached it) counts as everyone's too.
3. Leave out the tickets you already left in this session with questions still open: the room has heard them. The
   host can `jump` back to one.
4. Take the one with the lowest issue number. Tickets of absent domains stay on the map for another day.
5. Claim it (`grillo-wayfinder`, "Claiming a ticket"). Lost to another laptop: take the next one.
6. Read it in full with its comments, say its title in one line, and ask its first open question (a live question no
   answer comment names yet), in plain words a newcomer would follow, as grillo-wayfinder grills
   (`grillo-wayfinder`, "The four kinds of ticket"). In Type mode offer clickable options (`AskUserQuestion`) with
   your recommendation marked; in Listen mode ask aloud in one short paragraph the host can read to the room.
7. **Nothing matches:** say so in one line, naming how many open tickets wait for absent domains, and wait for the
   next presence message or a `jump`.

## Recording an answer

Every answer follows `.claude/skills/grillo-wayfinder/references/record-answer.md`, one question at a time:

1. **Distil.** In Listen mode, read the talk (the kept talk, then the chunk) and write the answer to the question at
   hand in one or two plain sentences, using only what was said. The talk does not answer it: say so in one line,
   record nothing, and keep the talk for the next `use it`. In Type mode the member's message is the answer.
2. **The contradiction check** (record-answer.md, Step 1). On a clash, ask the room one question at a time; their
   reply arrives as a plain message or a `use it` chunk, and it joins the same talk and the same answer.
3. **The source file** (record-answer.md, Step 2), a **meeting** source:
   - `kind:` `meeting`
   - `who:` the present members' logins, separated by `, `, as the latest presence message gave them
   - `when:` the moment of `use it`, or of the typed answer, in ISO 8601 UTC (`date -u +%Y-%m-%dT%H:%M:%S.000Z`)
   - `where:` the session file's path, from the `session:` message
   - the text: in Listen mode the whole talk, word for word, line breaks kept; in Type mode the typed message

   ```
   kind: meeting
   who: ada-example, ben-example
   when: 2026-10-26T14:12:00.000Z
   where: .grillo/sessions/2026-10-26-140000.md

   Who can take a tool out of the shed for good?
   The member who lent it, I'd say.
   Yes, but they tell the shed keeper first.
   ```

4. **The answer comment** (record-answer.md, Step 3): `via:` and `from:` empty, `sources:` the meeting source's code.
5. **Listen mode only: the discussion comment**, right after the answer: the same `question:` and `sources:`, the
   session file in `session:`, and the same talk as the source, word for word.

   ```
   <!-- grillo:discussion -->
   who: ada-example
   when: 2026-10-26T14:12:30.000Z
   sources: S6
   via:
   question: Q3.2
   session: .grillo/sessions/2026-10-26-140000.md

   Who can take a tool out of the shed for good?
   The member who lent it, I'd say.
   Yes, but they tell the shed keeper first.
   ```

6. **No `session:` message yet** (the host has not started the session): a `use it` chunk is pasted text, a source of
   its own (`pasted-text`, record-answer.md's table), and a typed answer is the member talking to you
   (`own-time-answer`). The discussion then leaves `session:` empty.
7. **Drift.** Answer only the question at hand; what else was said may add a question to this ticket (the next `k`,
   asked after its other open questions), a new ticket, a fog line or an out-of-scope line, as grillo-wayfinder does
   (`grillo-wayfinder`, "Working a ticket" and "Ticket, fog or out of scope"), with its duplicate search first. A new
   ticket has no domain label: the next tagging round gives it one. Say in one line what you added.
8. Ask the ticket's next open question after this one. None left after it: re-read the ticket's answer comments
   and count its live questions that still have no answer (the ones skipped). None: say every question is answered
   and that the host may press "Done", which closes the ticket. Some: say how many stay open, naming their codes,
   and that "Done" now releases the ticket with them open.

## Leaving a ticket

`done`, the last `skip` and `jump` leave the ticket at hand the same way (`grillo-wayfinder`, "Working a ticket"):

- **Every live question answered:** post the decision comment (record-answer.md, "The comments"), with `sources:`
  every source its answers cite and a one-line `gist:`; close the ticket (`gh issue close <N> --reason completed`);
  add `- #<N> <gist>` under Settled on the map; update the plan from the answers; then apply the map-done rule
  (`grillo-wayfinder`, "The map-done rule"). When the map is done, the PRD is written in this agent before you pick
  again.
- **Questions still open:** release the ticket (`gh issue edit <N> --remove-assignee @me`). It returns to the pool,
  unlocked, its open questions visible.

Then report in one line: the ticket's title, the decision (or how many questions stay open), and the next ticket.

## Guardrails

- **Write only what these steps write**: tickets, the map and comments through `gh`, and sources through
  record-answer.md. Never write the session file, never commit any other file, never `git add -A`, never
  force-push, never `--no-verify`.
- **Nothing is recorded without "Use it" or a typed answer.** Talk you merely heard is never an answer.
- **Sensitive data.** Every member can read every issue and file. Never put a password, token or absolute machine
  path on them; personal details only as the room said them as part of an answer.
- **Scope does not grow quietly.** When the meeting turns into building the product, say so.

## Mistakes to avoid

| Mistake | What goes wrong |
|---|---|
| Picking a ticket whose domains nobody present declares | The room is asked what only an absent member knows. |
| Recording the talk above `skip`, `jump` or `done` | Words the host chose not to use become an answer. |
| A discussion that tidies or shortens the talk | The PRD's trace no longer shows what was really said. |
| A meeting source without the session file or the present members | Nobody can tell which meeting an answer came from. |
| Answering a question the talk did not settle | The room's decision is replaced by your guess. |
| Leaving a ticket assigned after `done` with questions open | Nobody else can take its open questions. |
| Closing a ticket without the map-done rule | Nobody starts the PRD writer, and the finished map waits for nothing. |
