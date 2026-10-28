# The PRD version file

**Every PRD version this skill writes follows this file**, in the project folder at
`.claude/skills/grillo-prd/references/prd-format.md`. Grillo's PRD view reads the file as written here, and every
code in it must lead a reader to who said what, when and where. A version is one file, `.grillo/prd/v<n>.md` on
`main`, written once and never changed.

## The file

Two header lines, an empty line, the body, the appendix marker line, then the audit appendix:

```
version: 2
date: 2026-10-26T15:00:00.000Z

# Elm Street tool share

## Flows

- A member borrows at the shed by holding their garden key card to the reader. [S2, Q2.1]
- The shed screen shows who has each tool right now. [no source]

<!-- grillo:appendix -->
# Audit appendix

## Sources

### S2
- Kind: own-time-answer
- Who: Ada Example, product
- When: 2026-10-24T09:10:00.000Z
- Where: Grillo, own-time chat on ticket #2

> Members borrow at the shed: they hold their garden key card to the reader and pick the tool on the screen.

## Questions

### Q2.1
- Question: How does a member borrow a tool?
- Ticket: #2 How members borrow tools
- Who: ada-example
- When: 2026-10-24T09:11:00.000Z
- Where: comment 2001 on ticket #2
- Sources: S2

> Members borrow at the shed with their garden key card.

## Unsourced

- Flows: The shed screen shows who has each tool right now.
```

**Header lines.** `version:` is the version's number, the same `n` as in the file name. `date:` is the moment the
version was written, ISO 8601 in UTC with milliseconds. Every line `<name>: <value>`, in this order, then one empty
line.

**The appendix marker** is a line reading exactly `<!-- grillo:appendix -->`. It appears once: the body is everything
before it, the appendix everything after it. Neither the body nor the appendix ever holds that line.

Write the file as Unix lines (a line break is `\n`), UTF-8 **without a byte-order mark**.

## The body

1. **A title**: the first line, `# ` and the project's name.
2. **One `## ` section per structure section**, in the order of `.grillo/structure.json`, its name spelled exactly
   as there. A structure section is written only when it rests on a decision (SKILL.md, "The section check"); every
   written section holds at least one statement.
3. **Statements, and nothing else.** Every line under a section is a statement, or a `### ` sub-heading that groups
   statements. A statement is **one line**: `- `, the statement in plain words, a space, then its **tag**. No
   introduction, no paragraph, no table: anything a reader needs is a statement with a tag.

**The tag** ends the line, in square brackets, and is one of two things:

- **Codes**: `[S4, Q12.3]`. The source codes first, then the question codes, each kind in number order, separated by
  a comma and one space. At least one question code. The questions are the ones whose answers the statement rests
  on; the sources are the ones those answers name in `sources:`, at least one per question. Every question belongs
  to a ticket closed with a decision.
- **`[no source]`**: the statement rests on no answer. It is still written, so a member can confirm it or remove it
  with `/grillo-prd feedback`, and it is listed under Unsourced.

The codes are the store's own, never made up:

- `S<n>` is the source file `.grillo/sources/S<n>.md`.
- `Q<ticket issue number>.<k>` is the `k`-th question of that ticket, as its Questions section lists it. A removed
  question, `(removed)`, is never cited.

A code means the same thing in every version: sources and questions keep their numbers for good, so `[S2, Q2.1]` in
version 1 and in version 5 point at the same words.

## The audit appendix

`# Audit appendix`, then three parts, always all three and in this order. A part with nothing in it holds the one
line `None.`

**`## Sources`**: one entry per source code the body cites, in number order, each cited code exactly once and no
code the body does not cite. An entry is `### S<n>`, then four lines copied from the source file's header lines,
then an empty line, then the source's text **word for word** as quote lines (`> ` before each line; an empty line
of the text becomes `>`):

- `- Kind:` its `kind:`.
- `- Who:` its `who:`.
- `- When:` its `when:`.
- `- Where:` its `where:`.

**`## Questions`**: one entry per question code the body cites, in ticket and then question order, each exactly once.
An entry is `### Q<n>.<k>`, then these lines, an empty line, then the answer's text word for word as quote lines:

- `- Question:` the question's text, as the ticket's Questions section has it.
- `- Ticket:` `#<ticket number> <ticket title>`.
- `- Who:` the answer comment's `who:`.
- `- When:` the answer comment's `when:`.
- `- Where:` `comment <comment id> on ticket #<ticket number>`.
- `- Sources:` the answer comment's `sources:`, as written there.

The answer is the question's latest answer comment recorded before the version's date: the one in force.

**`## Unsourced`**: one line per `[no source]` statement, in the order the body has them: `- <section name>: <the
statement, without its tag>`.

## The self-check (before saving)

Read the file once more, top to bottom, and fix it until every line holds:

1. The header lines read `version: <n>` and `date: <now>`; the marker line appears once.
2. Every line under a section is a statement ending with codes or `[no source]`, or a `### ` sub-heading.
3. Every question code is a live question of a ticket closed with a decision, and has an answer; every source code
   has its file in `.grillo/sources/`; every source in a tag is named by one of the tag's answers.
4. Every written section has at least one statement citing a question of a ticket whose Why it matters starts with
   that section's name.
5. The appendix lists every cited code once, in order, word for word; nothing else. Unsourced lists every
   `[no source]` statement.
