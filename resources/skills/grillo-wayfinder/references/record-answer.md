# Recording an answer

**Every Grillo skill records answers only through this file**, in the project folder at
`.claude/skills/grillo-wayfinder/references/record-answer.md`. An answer is recorded in three steps, always in this
order, one question at a time:

1. [The contradiction check](#step-1-the-contradiction-check): re-read the map and the related tickets; on a clash,
   ask the member follow-up questions before recording anything.
2. [The source file](#step-2-the-source-file): write `.grillo/sources/S<n>.md` and save it to `main`.
3. [The answer comment](#step-3-the-answer-comment): post it on the ticket with its marker, header lines and codes;
   then the discussion, when there is one.

The check comes first because the member's follow-up words are part of what they said: they go into the same source
and the same answer. The source comes before the comment because the comment cites the source's code, and a code
must point at a file that exists.

## Step 1: the contradiction check

Other laptops settle tickets at any moment, so what you read at the start of the session may be stale.

1. **Re-read now, from GitHub:** the map body (Settled, Fog, Out of scope), this ticket with every comment, and the
   related tickets: its blockers, the tickets it blocks (`gh api repos/{owner}/{repo}/issues/<N>/dependencies/blocking
   --jq '.[].number'`), every ticket whose Why it matters names the same structure section, and every ticket under
   Settled whose gist touches the answer's subject. For each related closed ticket, read its latest decision comment.
2. **Compare** the answer with the settled decisions, the other answers on related tickets, the out-of-scope lines and
   this ticket's assumptions.
3. **A clash:** record nothing yet. Tell the member what clashes, naming the other ticket by title and quoting its
   decision, then ask follow-up questions one at a time, with clickable options (`AskUserQuestion`), until the member
   settles it:
   - **The new answer stands** and the earlier decision must be looked at again: record the answer, then create a
     grilling ticket `Revisit: <title of the other ticket>` whose Why it matters names the same structure section,
     so the map is not done until the clash is settled.
   - **The member changes the answer:** record the changed answer.
   - **The earlier decision stands** and the answer is withdrawn: record nothing.
4. **No clash:** say so in one line and go on.

## Step 2: the source file

Every answer rests on at least one source. A source is a file `.grillo/sources/S<n>.md` on `main`: four header lines,
an empty line, then the words **word for word**, never a summary.

```
kind: own-time-answer
who: Ada Example, product
when: 2026-10-24T09:10:00.000Z
where: Grillo, own-time chat on ticket #2

Members borrow at the shed: they hold their garden key card to the reader.
```

**Header lines.** Each is `<name>: <value>` in this order, every line present even when its value is empty (nothing
after `<name>:`). A value is one line: a line break inside it is written as a space. Moments are ISO 8601 in UTC with
milliseconds (`2026-10-24T09:15:00.000Z`). The first empty line ends the header lines; everything after it is the
text, kept exactly as written.

**What to write, by where the answer came from:**

| Where the answer came from | `kind:` | `who:` | `when:` | `where:` | The text |
|---|---|---|---|---|---|
| The member, in a chat with this agent | `own-time-answer` | The member's name and role | When they said it | `Grillo, own-time chat on ticket #<N>` | Their words, follow-ups included |
| A live session (`use it`, or typed in Type mode) | `meeting` | The logins present, comma-separated | The moment of `use it` or of typing | The session file, `.grillo/sessions/<date>-<time>.md` | The transcript chunk or the typed answer |
| A `use it` chunk with no session running (a pasted or uploaded transcript) | `pasted-text` | Who spoke, as the member says | When it was said, as the member says | Where it was recorded, as the member says | The chunk |
| A member's comment written in GitHub's own app | `own-time-answer` | The comment author's login | The comment's `created_at` | `GitHub comment <id> on ticket #<N>` | The comment's text |
| Pasted text, such as an email | `pasted-text` | Who wrote it, as the member says | When it was written, as the member says | How it arrived, as the member says | The pasted text |
| A document or a research finding | `document` | Its author | Its date | Its title and link | The passage the answer rests on |

When the member gives no written source, their own words are the source: `own-time-answer`, with their name, the date,
how they heard it under `where:`, and their exact words.

**One source, many answers.** When one email or one chunk answers several questions, write the source once and cite
its code from each answer. Before writing a new source, look in `.grillo/sources/` for one already holding the same
words; cite it instead of writing a copy.

**Numbering and saving.** A number never changes once pushed; PRD versions cite sources by it.

1. `git pull --ff-only`.
2. The number is the next free one: the highest `n` among `.grillo/sources/S<n>.md`, plus one (`S1` when there is
   none).
3. Write the file without a byte-order mark, then `git add .grillo/sources/S<n>.md` (that file only, never
   `git add -A`), `git commit -m "chore(grillo): add source S<n>"` and `git push origin HEAD:main`.
4. **Push rejected because someone pushed first** (`fetch first` or `non-fast-forward`): undo your commit and file,
   keeping the text (`git reset --soft HEAD~1`, `git rm --cached -q .grillo/sources/S<n>.md`, then delete the file),
   and start again at step 1 with the next free number.
5. **Push refused because `main` is protected:** push the commit to a branch of its own with a unique name,
   `grillo/save-<milliseconds since 1970>` (`git push origin HEAD:refs/heads/grillo/save-<ms>`). Then undo the local
   commit and file exactly as in step 4, so your local `main` never drifts from GitHub's. Open a pull request for the
   branch, always with a title and a body, since `gh` refuses to ask for them in an agent's shell (`gh pr create
   --base main --head grillo/save-<ms> --title "chore(grillo): add source S<n>" --body "Grillo could not save source
   S<n> straight to main, which is protected. Merge this pull request to keep it."`), and tell the member that the
   source waits for that pull request.

## Step 3: the answer comment

Post the answer as a comment on the ticket (`gh issue comment <N> --body-file <file>`, the file written without a
byte-order mark). Then read the ticket's comments back and check yours starts with its marker.

1. The question must be a live question of this ticket. An answer to a question the ticket does not hold yet first adds
   that question (the next `k`, by a body edit), then answers it.
2. **Typed or picked-up answers** get the answer comment only. **Listen mode** (a transcript chunk with `use it`) gets
   the answer comment, then a discussion comment holding the whole talk word for word.
3. **Finishing a ticket** posts a decision comment, before the ticket closes (SKILL.md, "Working a ticket").

### The comments

Each starts with a marker line, then its header lines in this order (same rules as above), an empty line, then the
text.

| First line | Record | Header lines, in order | Text |
|---|---|---|---|
| `<!-- grillo:answer -->` | An answer to one question | `who:`, `when:`, `sources:`, `via:`, `question:`, `from:` | The answer |
| `<!-- grillo:discussion -->` | The talk around an answer | `who:`, `when:`, `sources:`, `via:`, `question:`, `session:` | The transcript segment, word for word |
| `<!-- grillo:decision -->` | The ticket's final answer | `who:`, `when:`, `sources:`, `via:`, `gist:` | The decision |

- `who:` the login of the member who recorded it, the member this agent runs for (`gh api user --jq .login`).
- `when:` the moment it was recorded.
- `sources:` the source codes it rests on, separated by `, ` (`S1, S4`). Never empty on an answer.
- `via:` empty when recorded in Grillo; `github` when turned from a member's comment written in GitHub's own app;
  `generic-agent` when recorded by a generic agent.
- `question:` the code of the question it belongs to, `Q<ticket issue number>.<k>`.
- `from:` on an answer turned from a member's GitHub comment, that comment's numeric id; empty otherwise. Only such an
  answer carries `via: github`.
- `session:` the session file the segment was cut from; empty when the discussion was typed.
- `gist:` the one line the map's Settled list shows for this ticket.

An answer typed in a chat:

```
<!-- grillo:answer -->
who: ada-example
when: 2026-10-24T09:11:00.000Z
sources: S2
via:
question: Q2.1
from:

Members borrow at the shed with their garden key card.
```

An answer turned from a member's GitHub comment, recorded by another member's agent:

```
<!-- grillo:answer -->
who: ben-example
when: 2026-10-24T13:01:00.000Z
sources: S4
via: github
question: Q3.1
from: 3001

Only members who hold a key card may lend tools.
```

The talk around an answer, cut from a live session:

```
<!-- grillo:discussion -->
who: ada-example
when: 2026-10-24T09:21:00.000Z
sources: S3
via:
question: Q2.3
session: .grillo/sessions/2026-10-24-091500.md

How long should people keep a drill? A week sounds fair. A week, then it goes back on the wall.
```

The ticket's final answer:

```
<!-- grillo:decision -->
who: ada-example
when: 2026-10-24T09:25:00.000Z
sources: S2, S3
via:
gist: Borrow at the shed with a key card, keep a tool for a week

Members borrow at the shed with their garden key card and keep a tool for at most a week.
```

A comment with no marker is a plain member comment, written in GitHub's own app. It waits to be turned into an answer
until an answer comment names its id in `from:`; never edit or delete it.
