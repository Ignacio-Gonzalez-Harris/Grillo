# The score file

**Every score this skill writes follows this file**, in the project folder at
`.claude/skills/grillo-score/references/score-format.md`. Grillo's PRD view reads the file as written here. A score is
one file, `.grillo/prd/v<n>.score.json` on `main`, beside the version `.grillo/prd/v<n>.md` it scores. A rerun
replaces it; nothing else ever changes it.

## The file

A JSON object with exactly three fields, and each item exactly three fields:

- `overall`: the PRD's mark, a number from 0 to 10 with at most one decimal ([The overall mark](#the-overall-mark)).
- `criteria`: the quality half, one item per criterion of [the eight criteria](#quality-the-eight-criteria), in that
  order, named exactly as there.
- `sections`: the coverage half, one item per section of `.grillo/structure.json`, in the structure's order, named
  exactly as there.
- Each item: `name`, `mark` (a whole number from 0 to 10) and `comment` (one line, [The comment](#the-comment)).

Write it with two-space indentation, as Unix lines (a line break is `\n`), UTF-8 **without a byte-order mark**, with
one line break at the end. A score of a made-up four-section PRD, for a tool share in a community garden:

```json
{
  "overall": 7.1,
  "criteria": [
    {
      "name": "Clear",
      "mark": 8,
      "comment": "Short statements in plain words, but taking a tool out \"for good\" [S5, Q3.2] is never defined, so readers may take it to mean sold, binned or retired. Suggestion: say in one statement what happens to a tool taken out for good, such as it leaves the list of tools."
    },
    {
      "name": "Complete",
      "mark": 6,
      "comment": "A loan starts and has a week limit [S3, Q2.3], but nothing says how a tool comes back or what happens when the week runs out, so a builder cannot finish the borrowing flow. Suggestion: ask the members how a member returns a tool and what happens to a late one, and add both as statements."
    },
    {
      "name": "Verifiable",
      "mark": 7,
      "comment": "Most statements can be checked, but \"right now\" in the shed screen statement [S8, Q7.1] sets no time, so no test can say it passes. Suggestion: say how soon a loan shows on the screen, such as within one minute."
    },
    {
      "name": "Tied to objectives",
      "mark": 5,
      "comment": "The Problem states the loss, 6 of 40 tools [S6, Q4.1], but sets no goal, so no statement can be checked against an outcome. Suggestion: decide a target such as at most one missing tool at the next autumn count, and say which flows serve it."
    },
    {
      "name": "Consistent",
      "mark": 9,
      "comment": "No two statements contradict each other, and the shed keeper's powers agree across Users and roles and Permissions. Suggestion: say \"key-card holder\" wherever only key-card holders are meant, since Permissions narrows \"member\" to them."
    },
    {
      "name": "Feasible",
      "mark": 8,
      "comment": "A key-card reader and one shed screen are ordinary hardware for a community garden, but no statement says the shed has power or a network. Suggestion: confirm with the members that the shed can run a screen and a reader, and add it as a statement."
    },
    {
      "name": "Needs, not solutions",
      "mark": 6,
      "comment": "The key-card reader [S2, Q2.1] fixes how members borrow before the need behind it is stated, so a cheaper way could never be weighed. Suggestion: state the need first, such as only known members can borrow, and keep the reader as the chosen way to meet it."
    },
    {
      "name": "Scope and priorities",
      "mark": 4,
      "comment": "Nothing says what the first version must do or what is left out, so a builder cannot tell a must from a nice-to-have. Suggestion: ask the members what is out of scope and which flows the first version needs, and add both as statements."
    }
  ],
  "sections": [
    {
      "name": "Problem",
      "mark": 6,
      "comment": "One decided fact, the loss at the autumn count [S6, Q4.1], but not who it hurts or what outcome the garden wants. Suggestion: add the outcome the garden wants, such as fewer missing tools at the next count."
    },
    {
      "name": "Users and roles",
      "mark": 8,
      "comment": "Both roles are decided [S7, Q6.1], but not whether the shed keeper also borrows like any member. Suggestion: ask whether the shed keeper borrows like everyone else, and say so."
    },
    {
      "name": "Flows",
      "mark": 7,
      "comment": "Borrowing, the week limit and the list of tools out [S8, Q7.1] are decided, but returning a tool is not. Suggestion: add the return flow, including a tool brought back late."
    },
    {
      "name": "Permissions",
      "mark": 9,
      "comment": "Who may lend and who may take a tool out for good are both decided [S4, Q3.1] [S5, Q3.2]. Suggestion: say who may add a tool to the list or take one off it."
    }
  ]
}
```

## Quality: the eight criteria

Each criterion is marked over the whole PRD body. They come from ISO/IEC/IEEE 29148 (requirements engineering),
the INCOSE guide for writing requirements, and product-management guides, and all eight weigh the same.

| Criterion | It asks | Marks it down |
|---|---|---|
| **Clear** | Does every statement have one meaning that a newcomer reads the same way? | Vague words (fast, easy, user-friendly, etc.), terms never explained, one statement holding two ideas. |
| **Complete** | Is everything a builder needs there: each flow from its start to its end, what happens when it goes wrong? | A flow that stops halfway, a missing case, a role named but never given anything to do. |
| **Verifiable** | Can each statement be checked as met or not met, by a test, an inspection or a number? | Words with no measure (right now, often, enough); a `[no source]` statement, which nobody has confirmed yet. |
| **Tied to objectives** | Does the PRD state a goal, and does each statement serve it? | No goal, a goal with no measure, statements that serve no stated problem. |
| **Consistent** | Do the statements agree with each other, one word for one thing? | Two statements that contradict each other; one thing called by two names, or two things by one. |
| **Feasible** | Can it be built with the means and within the limits the PRD gives? | Something that needs means the PRD never mentions, or limits that cannot all hold together. |
| **Needs, not solutions** | Does it say what is needed and why, leaving how to the builders? | A how fixed before the need behind it is stated. A how the members chose on purpose, with its need stated, is fine. |
| **Scope and priorities** | Does it say what is in, what is out, and what comes first? | No out-of-scope statement, no order of importance, nothing on what the first version needs. |

## Coverage: one mark per section

Each section of `.grillo/structure.json` is marked on one question: **does it hold real decisions, or gaps?** Read
the section's `note`: that is what the section must answer.

- **High (8 to 10):** every point the note asks about is answered by statements ending with codes.
- **Middle (4 to 7):** some points the note asks about are left out, or rest on `[no source]` statements.
- **Low (1 to 3):** the section answers little of its note, or mostly with `[no source]`.
- **0:** the version does not write the section at all (the structure gained it after the version was written).

## Marks

Every item's mark is a whole number:

| Mark | Means |
|---|---|
| 10 | Nothing weak. |
| 8 to 9 | One small gap. |
| 5 to 7 | Several statements weak, or one important gap. |
| 2 to 4 | Weak across most of the PRD, or of the section. |
| 0 to 1 | Not met at all. |

## The overall mark

Quality and coverage weigh **half each**, and every mark inside a half weighs the same:

overall = (mean of the eight criteria marks + mean of the section marks) / 2, rounded to one decimal.

In the example: the criteria give (8 + 6 + 7 + 5 + 9 + 8 + 6 + 4) / 8 = 6.625, the sections (6 + 8 + 7 + 9) / 4 = 7.5,
so the overall is (6.625 + 7.5) / 2 = 7.0625, written `7.1`.

## The comment

One comment per item, on **one line**, in plain words a newcomer follows:

1. **What is weak**, naming the statement by its words or its tag (`[S3, Q2.3]`), never by a code the version does
   not cite.
2. **Why** it matters: what a reader or builder cannot do because of it.
3. `Suggestion: ` and **one concrete change**: the words to add, the question to ask the members, the statement to
   confirm or remove. For a mark of 10, say what holds it there; the suggestion may then be `Suggestion: none.`

Never put a Grillo marker (`<!-- grillo:`), a password, a token or a machine path in a comment.

## Self-check

Before saving, check the file against every line below, and fix it until it passes:

1. It is JSON with exactly `overall`, `criteria` and `sections`, and every item exactly `name`, `mark` and `comment`.
2. `criteria` holds the eight criteria, in the order of the table above, named exactly as there.
3. `sections` holds every section of `.grillo/structure.json`, in its order, named exactly as there, each once; a
   section the version does not write is marked 0.
4. Every mark is a whole number from 0 to 10.
5. Every comment is one line, holds `Suggestion: `, and cites only codes the version itself cites.
6. `overall` is what [The overall mark](#the-overall-mark) gives, to one decimal.
