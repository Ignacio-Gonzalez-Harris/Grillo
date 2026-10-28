---
name: grillo-score
description: 'Grillo''s PRD grader. Scores the latest PRD version .grillo/prd/v<n>.md from 0 to 10 in two halves of equal weight: quality (clear, complete, verifiable, tied to objectives, consistent, feasible, needs not solutions, scope and priorities) and coverage (does each section of the project''s PRD structure hold real decisions rather than gaps), every criterion and every section with one mark and one comment saying what is weak, why, and a concrete suggestion. Saves it as .grillo/prd/v<n>.score.json beside the version; a rerun replaces it. Guidance, never a gate: nothing happens by itself after a low score. Started by grillo-prd after it saves a version, and by "Rerun" on the PRD view.'
disable-model-invocation: true
---

# grillo-score

> [!NOTE]
> **Grillo ships this folder beside `grillo-wayfinder` and `grillo-prd`** in the project folder's `.claude/skills/`
> and writes no `CLAUDE.md` there. Step 0 is grillo-wayfinder's, and the PRD version file this skill reads is
> grillo-prd's: `.claude/skills/grillo-prd/references/prd-format.md`. The score file's own format, the criteria and
> the marks are [`references/score-format.md`](references/score-format.md).

The score tells the members how good their PRD is and what to improve, one comment at a time. It is advice for the
people who read it, never a decision: the members choose what to do with it.

## Words this skill uses

- **PRD version**: one numbered, dated file `.grillo/prd/v<n>.md` on `main`. The newest one is the PRD.
- **Score**: one file `.grillo/prd/v<n>.score.json` beside the version it scores: an overall mark, one mark and
  comment per quality criterion, and one per structure section.
- **Structure section**: one section of the project's PRD structure, `.grillo/structure.json`, each a `name` and a
  one-line `note` saying what the section must answer.
- **Statement**: one line of the PRD body, ending with its tag: codes such as `[S4, Q12.3]`, or `[no source]` when
  no answer supports it.

## Ground rules

1. **Score what the PRD says, and nothing else.** Read the version and the structure only: a reader of the PRD sees
   nothing more, so a gap the PRD leaves is a gap even when a ticket somewhere holds the answer.
2. **One mark and one comment per item**, as [`references/score-format.md`](references/score-format.md) says: what
   is weak, why, and a concrete suggestion. A mark without a reason helps nobody.
3. **Same weight for everything.** Quality and coverage are half each; every criterion weighs the same, and so does
   every section.
4. **Write only the score file.** A run writes at most one file, `.grillo/prd/v<n>.score.json`. The version, every
   other version and every other score stay exactly as they are.
5. **GitHub and `main` are the single truth.** Other laptops change the project at any moment: read the version and
   the structure fresh at the start of every run.
6. **Call every issue by its title**, with the number beside it, never a bare `#<N>`.
7. **Sensitive data.** Every member can read the score. Never put a password, token or absolute machine path in it.

## The command

| Command | Who types it | What it does |
|---|---|---|
| `/grillo-score` | grillo-prd, in the same agent, once it has saved a version (`grillo-prd`, "Saving a version"); "Rerun" on the PRD view | [Scores the latest version](#scoring-a-version) and saves the score, replacing an earlier score of that version. |

It takes no argument: it always scores the latest version, the PRD the members read.

## Scoring a version

1. Run grillo-wayfinder's Step 0 (`grillo-wayfinder`, "Step 0: check GitHub and the project folder"). When its
   `git pull --ff-only` is refused, say so in one line and stop: a score written on a stale `main` may score a
   version that is no longer the latest.
2. **Find the version**: the highest `n` among `.grillo/prd/v<n>.md` on `main`. There is none: say the PRD has not
   been written yet, and stop.
3. **Read** that version (the body above the line `<!-- grillo:appendix -->`; the appendix only to look up what a
   code stands for) and `.grillo/structure.json`.
4. **Quality.** For each of the eight criteria, in the order of
   [`references/score-format.md`](references/score-format.md), read the whole body against what the criterion asks,
   give it a mark from the marks table there, and write its comment.
5. **Coverage.** For each structure section, in the structure's order, read what the version writes under it
   against the section's `note`, give it a mark, and write its comment. A section the version does not write is
   marked 0, its comment saying it is not written and that regenerating the PRD writes it once it has a decision.
6. **Overall**: work it out as the format file says, half quality and half coverage, to one decimal.
7. **Self-check**: run the self-check in [`references/score-format.md`](references/score-format.md) and fix the
   score until it passes.
8. **Save** it ([Saving a score](#saving-a-score)).
9. **Report** ([Reporting back](#reporting-back)).

## Saving a score

1. `git pull --ff-only`.
2. Write the score to `.grillo/prd/v<n>.score.json`, `n` being the version you scored, without a byte-order mark. A
   score already there is replaced: that is a rerun.
3. `git add .grillo/prd/v<n>.score.json` (that file only), `git commit -m "chore(grillo): score PRD version v<n>"`
   and `git push origin HEAD:main`.
4. **Push rejected because someone pushed first** (`fetch first` or `non-fast-forward`): keep your score, undo your
   commit (`git reset --soft HEAD~1`) and the file: for the version's first score,
   `git rm --cached -q .grillo/prd/v<n>.score.json` and delete the file; for a rerun,
   `git restore --staged --worktree .grillo/prd/v<n>.score.json`. Then start again at step 1. When another laptop
   scored the same version meanwhile, yours replaces it: the latest score stands.
5. **Push refused because `main` is protected:** push the commit to a branch of its own,
   `grillo/score-<milliseconds since 1970>` (`git push origin HEAD:refs/heads/grillo/score-<ms>`), then undo the
   local commit and file exactly as in step 4, so your local `main` never drifts from GitHub's. Open a pull request
   with a title and a body (`gh pr create --base main --head grillo/score-<ms> --title "chore(grillo): score PRD
   version v<n>" --body "Grillo could not save the score of PRD version v<n> straight to main, which is protected.
   Merge this pull request to keep it."`) and tell the member that the score waits for that pull request.

## Guidance, never a gate

The score is advice. Whatever the marks, nothing happens by itself after it:

- **Never** open, edit, close or comment on a ticket, never add a fog line, never write or change a PRD version,
  and never start another command because of a mark. A low score blocks nothing and starts nothing.
- When grillo-prd started this skill, its run goes on exactly as it would have without the score.
- The members decide what to act on. When the member asks how, point them to "Talk to an agent about this PRD" on
  the PRD view, which starts `/grillo-prd feedback`; never start it for them.

## Guardrails

- **Write only what these steps write**: the one score file, through the commit and push above. Never commit any
  other file, never `git add -A`, never force-push, never `--no-verify`.
- **Never edit the PRD to raise its mark.** The PRD changes only through the PRD writer and the members' answers.
- **Never invent a code.** A comment names a statement by its words or by a tag the version itself carries.

## Reporting back

Short, one fact per line: the version scored and its overall mark first; then the lowest two or three items (a
criterion or a section), each with its mark and its suggestion; then that the score is guidance and the full list is
on the PRD view. Nothing waits on it.

## Mistakes to avoid

| Mistake | What goes wrong |
|---|---|
| Opening a ticket or a fog line after a low mark | The score becomes a gate the members never asked for, and the map is no longer done. |
| A mark with no comment, or a comment with no suggestion | The member sees a number and cannot act on it. |
| Scoring from the tickets instead of the PRD | Gaps the reader of the PRD meets are hidden by answers the PRD never says. |
| Dropping a structure section the version does not write | The coverage half looks better than the PRD is. Mark it 0. |
| Weighing a favourite criterion more | The overall no longer means the same across versions. |
| Writing over the version, or another version's score | A version is written once; only its own score is ever replaced. |
