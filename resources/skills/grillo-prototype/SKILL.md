---
name: grillo-prototype
description: 'Grillo''s prototype agent (release 3). /grillo-prototype <ticket number> claims one prototype ticket (labelled wayfinder:prototype) and works it as wayfinder works prototypes, with the member: it builds the least that makes the choice visible (a mock screen, a page outline, a sketch of a flow), throwaway and kept in a scratch folder outside the project folder, shows it, and asks what the member thinks of it one question at a time. Each reaction is recorded as an answer through the grilling engine''s record-answer reference: the contradiction check, then the member''s own words saved as a source, then the answer comment, then the exchange about the prototype word for word as its discussion. At done every question answered closes the ticket with a decision and applies the map-done rule, which starts /grillo-prd once the map is done; questions still open release the ticket to the pool. Started by Grillo: a launch from a prototype ticket on ticket management types /grillo-prototype <ticket number>.'
argument-hint: "<ticket number>"
disable-model-invocation: true
---

# grillo-prototype

> [!NOTE]
> **Grillo ships this folder beside `grillo-wayfinder`** in the project folder's `.claude/skills/` and writes no
> `CLAUDE.md` there. The map, the tickets, the claim rule, the grilling and the map-done rule are that skill's, and
> this skill follows them by section name: `.claude/skills/grillo-wayfinder/SKILL.md`. Every answer, discussion and
> decision is recorded only through `.claude/skills/grillo-wayfinder/references/record-answer.md`, which this file
> calls record-answer.md.

A prototype ticket asks how a thing should look or behave. An abstract choice is hard to judge, so this agent builds
something rough for the member to react to, then records what their reaction decided.

## Words this skill uses

- **Member**: a person on the project, known by their GitHub login and listed in `.grillo/members.json` with a `role`.
  You act for the member who runs this agent, the **runner**: their login is `gh api user --jq .login`.
- **Prototype ticket**: an issue labelled `wayfinder:prototype`, hung under the map (the issue labelled
  `wayfinder:map`).
- **Live question**: a line under the ticket's `### Questions` that is not `(removed)`. It is **answered** once an
  answer comment (`<!-- grillo:answer -->`) on the ticket names its code `Q<ticket issue number>.<k>` in `question:`.
- **Prototype**: something quick and disposable that makes a choice visible: a mock screen, a page outline, a sketch
  of a flow, a sample of the data. It is evidence for the decision, never part of the product.
- **Scratch folder**: a new empty folder outside the project folder, made with `mktemp -d`.
- **Now**: the moment you record, in ISO 8601 UTC with milliseconds: `date -u +%Y-%m-%dT%H:%M:%S.000Z`.
- **Project folder**: the clone of the project's repository the agent runs in. Its default branch is called `main`
  below, whatever its real name.

## Ground rules

1. **A question is never answered by you.** The prototype shows a choice; the runner's reaction to it is the answer.
   Never record what they did not say.
2. **Every answer goes through record-answer.md**, in its order: the contradiction check, the source file, the answer
   comment, then the discussion. Never post an answer whose source is not on `main`.
3. **The prototype stays outside the project.** It lives in a scratch folder, is never committed and never pushed, and
   its path is never written on a ticket or into a source.
4. **Words are kept word for word.** A source holds what the runner said exactly; the answer is what their reaction
   decided; a discussion is the exchange exactly as it went.
5. **GitHub is the single truth.** Other laptops write at any moment: re-read the ticket and its comments just before
   you write to it.
6. **Call every ticket by its title**, with the number beside it, never a bare `#<N>`.

## The command: `/grillo-prototype <ticket number>`

`<ticket number>` is the ticket's issue number in digits with no `#` (`/grillo-prototype 12`). Any other argument: say
in one line that the command takes a ticket number, and stop.

1. Run grillo-wayfinder's Step 0 and its structure-section step (`grillo-wayfinder`, "Step 0: check GitHub and the
   project folder" and "The structure-section step"). When the `git pull --ff-only` is refused, say so in one line and
   stop: no answer can be recorded without saving its source to `main`.
2. **Check the ticket**: `gh issue view <N> --json number,title,state,labels,assignees`.
   - Not a ticket (no `wayfinder:*` kind label, or the map itself): say so and stop.
   - Another kind: say so, name the command that works it, and stop. A grilling ticket: `/grillo-answer <N>`; a
     research ticket: `/grillo-research <N>`; a task ticket: `/grillo-task <N>`.
   - Closed: say so, with its settled gist when it has one, and stop; reopening is a screen action, never this
     skill's.
3. **Claim it** (`grillo-wayfinder`, "Claiming a ticket"). Held by another member: say who holds it, write nothing on
   it, and stop. Already assigned to the runner: it is theirs; carry on.
4. **Read it in full**, with every comment and its numeric id (`grillo-wayfinder`, "Making and changing issues"), and
   the decisions of the tickets it is blocked by. Tell the runner in one line which questions are answered already
   and which are open. A plain comment no answer names yet is an answer a member wrote from GitHub: name it in one
   line, say `/grillo-answer pickup` records it, and leave it alone.
5. **Build the prototype and show it**: [Building the prototype](#building-the-prototype).
6. **Walk the open questions one at a time**, in order, against the prototype, grilling as grillo-wayfinder does
   (`grillo-wayfinder`, "The four kinds of ticket"): ask what the runner thinks of what they see, not whether they
   approve it. Ask why, name the cost of each option, and say so when you disagree. When they ask for a change, make
   it in the prototype and show it again.
7. **Record each answer the moment it is firm**: [Recording a reaction](#recording-a-reaction).
8. **Drift**: as grillo-wayfinder says (`grillo-wayfinder`, "Working a ticket" step 6). What the runner noticed beyond
   the question at hand may add a question (the next `k`), a new ticket or a fog line.
9. **Once every live question is answered**, offer done in one line. The runner says done: go to
   [Done](#done-finishing-the-ticket).

## Building the prototype

1. **Build the least that makes the choice visible**, from the ticket's questions and the decisions it rests on: a
   mock screen as one HTML file, a page outline, a flow as numbered steps, a few sample records. Where two options
   compete, show both side by side. Made-up example values only, never a real person's or customer's data.
2. **Keep it in a scratch folder** (`mktemp -d`), never in the project folder.
3. **Show it**: tell the runner it is meant to be thrown away, and how to open it (the file to open in their browser,
   or the outline in the chat). The path is said in the chat only.
4. **Say in one line what it shows.** That line, in words, opens the discussion of every answer it leads to, so a
   member who never saw the prototype knows what the runner reacted to.

## Recording a reaction

Every answer goes through record-answer.md, in its order:

- **Step 1, the contradiction check** (record-answer.md, "Step 1: the contradiction check"), exactly as written there.
- **Step 2, the source** (record-answer.md, "Step 2: the source file"): `kind: own-time-answer`; `who:` the runner's
  name and role (`gh api user --jq .name`, and their `role` in `.grillo/members.json`); `when:` when they said it;
  `where:` `Grillo, own-time chat on ticket #<N>`; the text: the runner's own words about the prototype for this
  answer, follow-ups included, word for word.
- **Step 3, the answer comment** (record-answer.md, "Step 3: the answer comment"): `who:` the runner's login, `via:`
  and `from:` empty; the text: what their reaction decided, never more than they said.
- **The discussion, always.** The prototype is how the answer was reached: right after the answer, post a
  `<!-- grillo:discussion -->` comment citing the same source, with `session:` empty and the exchange about this
  question word for word as its text, each line starting with who spoke (`Agent:` or the runner's login). Its first
  line is `Agent:` and what the prototype shows, in words, never a file path.

A source, its answer and its discussion:

```
kind: own-time-answer
who: Ada Example, product
when: 2026-10-26T14:05:00.000Z
where: Grillo, own-time chat on ticket #2

One week. A month is too much to read on a phone, nobody plans that far ahead.
```

```
<!-- grillo:answer -->
who: ada-example
when: 2026-10-26T14:06:00.000Z
sources: S2
via:
question: Q2.1
from:

The rota shows one week at a time.
```

```
<!-- grillo:discussion -->
who: ada-example
when: 2026-10-26T14:06:00.000Z
sources: S2
via:
question: Q2.1
session:

Agent: The mock shows the rota twice, side by side: one week as seven columns, and a whole month as a grid.
Agent: Which would members rather see when they open the rota?
ada-example: One week. A month is too much to read on a phone, nobody plans that far ahead.
```

## Messages from Grillo's screens

While the agent runs, a screen may type a protocol message: its **last line** is the control line, with nothing else
on it. Lines above it are text that was already in the input box.

| Control line | What you do |
|---|---|
| `use it` | The lines above are a transcript chunk: members talking about the prototype. Take from it the answer to the question at hand, and to any other open question of this ticket it answers, and record each through record-answer.md, with the whole chunk word for word as each answer's discussion. After a session message the chunk is a `meeting` source pointing at that session file; with none it is a `pasted-text` source written once and cited by every answer it gives: ask the runner, in one question, who spoke, when and where it was recorded, unless the chunk says so, and write the discussion with `session:` empty. An empty chunk records nothing: say nothing was heard. |
| `session: <path to session file>` | A live session is running. Every answer you record from a later `use it` cites a `meeting` source pointing at that session file, and its discussion names the file in `session:` (record-answer.md, "Step 2: the source file"). |
| `done` | No screen types it to this agent; a runner who types it wants to finish now: go to [Done](#done-finishing-the-ticket). The lines above it are not recorded. |
| `present:`, `mode:`, `skip`, `jump` | These belong to a live meeting, never to a prototype agent: say so in one line and carry on. |

A message whose last line is none of these is the runner talking to you, as always.

## Done: finishing the ticket

Re-read the ticket and every comment, fresh from GitHub, then:

- **Every live question answered:**
  1. Post the decision comment (record-answer.md, "The comments"): `who:` the runner's login, `when:` now,
     `sources:` every source code the ticket's answers cite, each once, in number order; `via:` empty; `gist:` the
     decision in one line; the text: the ticket's final answer, saying in words what the prototype showed.
  2. Close it: `gh issue close <N> --reason completed`.
  3. Add `- #<N> <gist>` under Settled on the map, then read it back (`grillo-wayfinder`, "Making and changing
     issues").
  4. Update the plan as grillo-wayfinder says (`grillo-wayfinder`, "Working a ticket" step 7): the tickets the
     answers raised, fog they made precise, what they put beyond the PRD.
  5. Apply the map-done rule (`grillo-wayfinder`, "The map-done rule"): with no open ticket and no fog line left, tell
     the runner the map is done and run `/grillo-prd` in this same agent.
- **Questions still open:** post no decision. Release the ticket, `gh issue edit <N> --remove-assignee @me`, and read
  the assignees back: it returns to the pool, unlocked, with its open questions visible to everyone. Name the open
  questions by code in one line.
- **Either way**, then let go of its hold (`grillo-wayfinder`, "Holding a ticket on this laptop"), so another
  grilling agent on this laptop may take it; a ticket you never claimed here has no hold of yours to let go of.

Then tell the runner the scratch folder may be deleted. After done, **the agent stops**: report, and take no other
ticket.

## Guardrails

- **Write only what these steps write**: answer, discussion and decision comments, the close or the release, the
  map's Settled line, the plan changes grillo-wayfinder's steps make, and source files under `.grillo/sources/`
  through record-answer.md. The prototype stays in its scratch folder. Never commit any other file, never
  `git add -A`, never force-push, never `--no-verify`.
- **Nothing disappears without a yes.** Deleting a comment, closing a ticket as out of scope or merging it waits for
  the runner's explicit yes.
- **Sensitive data.** Every member can read every issue and file. Never put a password, token or absolute machine
  path on them; personal details only as the runner said them as part of an answer.
- **Scope does not grow quietly.** The prototype answers the ticket's questions and nothing more; when it starts
  turning into the product, stop and say so.

## Reporting back

Short, one fact per line, tickets by title: what the prototype showed, each question with what the reaction decided,
then the outcome (closed with its gist, or released with its open questions), then whether the map is done.

## Mistakes to avoid

| Mistake | What goes wrong |
|---|---|
| Asking whether the runner approves | A yes says nothing about why; ask what they think of it. |
| Building the prototype in the project folder | It shows up as a change, and may be committed with a source. |
| Writing the prototype's path on the ticket | Nobody else can open it, and it leaks a machine path. |
| Recording an answer with no discussion | Nobody can tell what the runner was reacting to. |
| Posting the answer before its source is on `main` | The answer cites a code nobody can open. |
| Closing without the map-done rule | The finished map waits for a PRD nobody writes. |
| Working a ticket another member holds | Two members answer the same questions at once. |
