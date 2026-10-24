# Grillo's skills: commands, the screen-to-agent protocol and the map-done rule

Every Grillo skill and every screen that starts or drives an agent follows this file. It holds three things:
the command each skill answers to, the messages a screen types into a running agent, and the rule every skill
applies after closing a ticket. The records the skills read and write are in `docs/store-layout.md`; the
product is the PRD (`docs/PRDs/PRD.md`). A change here is a change to every skill and screen that uses it.

- **This file is never shipped.** The agent runtime copies only the `grillo-*` folders beside it into a
  project folder's `.claude/skills/`, and no `CLAUDE.md` is ever written into a project folder. So every rule
  below that a skill needs is written inside that skill's own files (PRD section 1.1, section 8 Shipped skill).
- **Each skill's own test** checks its `SKILL.md` name against the table below with `readCommandCatalogue()`
  from `catalogue.ts`; `catalogue.test.ts` checks the table itself.

## Commands

A screen starts an agent of the kind shown, in the project folder, and types the command as its first message
followed by Enter (the agent runtime's `firstMessage`). A skill that runs another skill, as the map-done rule
does, types nothing: it follows that skill in the same agent.

| Command | Skill folder | Agent kind | Release | Typed by | What it does |
|---|---|---|---|---|---|
| `/grillo-wayfinder <path to source file>` | `grillo-wayfinder` | grilling | 1 | Project creation (screen 2), once the idea is saved as source S1 | Reads the idea from the source file and creates the map, the tickets and their questions; the grilling engine every other skill builds on (PRD 4.2 item 6). |
| `/grillo-tagging` | `grillo-tagging` | grilling | 1 | "Run tagging round" on the map (screen 3) | Gives every open ticket one or more domains from the members' declared domains, or "no domain" (PRD 4.3 item 1). |
| `/grillo-meeting` | `grillo-meeting` | grilling | 1 | The host starting a live session on the meeting screen (screen 5), and the meeting panel's control for another grilling agent | Runs a live grilling session driven by the protocol messages below (PRD 4.5). |
| `/grillo-answer <ticket number>` | `grillo-answer` | grilling | 1 | Own-time answering with an agent (screen 6) | A grilling chat on one ticket in the member's own time; ends at `done` (PRD 4.4 items 2-3). |
| `/grillo-answer pickup` | `grillo-answer` | grilling | 1 | "Pick up GitHub comments" on ticket management (screen 4) | Turns members' plain comments written in GitHub's own apps into recorded answers marked "via GitHub" (PRD 4.4 item 5). |
| `/grillo-generic` | `grillo-generic` | generic | 1 | "+" on the tab bar, after the member names the tab (screen 7) | Any task outside the wayfinder flow, from pasted material and where it came from (PRD 4.6 item 9). |
| `/grillo-prd` | `grillo-prd` | grilling | 1 | A `mapDone` result on a screen (screens 3, 4 and 6), and every skill through the map-done rule | Writes the next PRD version the moment the map is done (PRD 4.7 items 1-5). |
| `/grillo-prd regenerate` | `grillo-prd` | grilling | 1 | "Regenerate" on the PRD view (screen 8), also after editing the structure | Writes a new version from everything, in the current structure; a section with no decision gets tickets or fog instead (PRD 4.7 item 3). |
| `/grillo-prd feedback` | `grillo-prd` | grilling | 1 | "Talk to an agent about this PRD" on the PRD view (screen 8) | The member says what is wrong; the agent edits the PRD or opens tickets (PRD 4.7 item 6). |
| `/grillo-support` | `grillo-support` | support | 2 | The support agent tab | Relays a member's message into another agent's chat, marked `from Support, for <member>` (PRD 4.6 item 7). |
| `/grillo-score` | `grillo-score` | grilling | 3 | `/grillo-prd` after it writes a version, and "Rerun" on the PRD view (screen 8) | Scores a PRD version from 0 to 10, as guidance and never a gate (PRD 4.7 item 7). |
| `/grillo-research <ticket number>` | `grillo-research` | research | 3 | Launch from a research ticket on ticket management (screen 4) | Works a research ticket as wayfinder does and records the finding as an answer with its sources. |
| `/grillo-prototype <ticket number>` | `grillo-prototype` | prototype | 3 | Launch from a prototype ticket on ticket management (screen 4) | Works a prototype ticket as wayfinder does and records the outcome as an answer with its sources. |
| `/grillo-task <ticket number>` | `grillo-task` | task | 3 | Launch from a task ticket on ticket management (screen 4) | Works a task ticket as wayfinder does and records the outcome as an answer with its sources. |

- **Names.** Each command is `/` followed by its skill folder's name: `grillo-` and lowercase words joined by
  hyphens. One skill may answer several commands, told apart by a mode word (`pickup`, `regenerate`,
  `feedback`); a command is never listed twice.
- **Arguments.** `<path to source file>` is the source file's path relative to the project folder, with `/`
  between folders: `/grillo-wayfinder .grillo/sources/S1.md`. `<ticket number>` is the ticket's GitHub issue
  number in digits, with no `#`: `/grillo-answer 12`.
- **Agent kinds** are the six of PRD section 3. The engine's own passes that belong to no ticket kind (the
  tagging round, the comment pickup, writing and scoring the PRD) open a grilling agent, the kind that runs
  the engine.
- **Releases** are those of PRD section 12. In release 1 tickets of every kind are created, but only grilling
  agents run: members work research, prototype and task tickets as grilling (with `/grillo-answer` or in a
  meeting) until release 3 (PRD 4.2 item 6).

## Screen-to-agent protocol

While an agent runs, a screen talks to it only by typing into its input box, exactly as a member would. These
are the messages a screen types, and what the agent must do with each.

**How a message is built**

1. A protocol message is one message, sent with Enter. Its **last line** is the control line: exactly one of
   the texts below, in lowercase, with nothing else on the line (spaces around it are ignored).
2. Any lines above the control line are transcript that was already in the input box: an open channel writes
   each 5-second slice into the box as it is spoken, without Enter (PRD 4.5 item 5). The screen adds the
   control line on a line of its own, with a line break that does not send, and then presses Enter. In an
   empty box the control line is the whole message.
3. A message whose last line is no control line is the member talking to the agent, as always. A control line
   with a value the agent cannot use (a login that is not a member, a ticket that is not open, a mode other
   than `listen` or `type`) changes nothing: the agent says what was wrong in one line and carries on.

**The messages**

| Message | Exact control line | The screen types it when | Accepted by | What the agent does |
|---|---|---|---|---|
| Presence | `present: <logins>` | The meeting agent has started, and every time the host ticks or unticks a member | `/grillo-meeting` | `<logins>` is every member ticked present, the host included, as GitHub logins separated by `, ` (`present: ana-example, ben-example`); each message replaces the whole list. The agent picks tickets for these members only: the next unblocked ticket whose domains match someone present, `domain:none` counting as everyone's (PRD 4.5 item 6). A change applies from the next ticket; the question at hand goes on. With an empty list (`present:`) the agent picks nothing and waits for the next presence message. |
| Session | `session: <path to session file>` | The host has started the live session, to every meeting agent; and to any agent whose channel opens while a session runs | Every agent | The session file's path relative to the project folder (`session: .grillo/sessions/2026-10-24-091500.md`). Every answer the agent then records from `use it` cites that session as its source, and every discussion names the file in its `session:` header line (`docs/store-layout.md`). With no session message, a `use it` chunk is pasted text: the agent records it as a source of its own. |
| Mode | `mode: listen` or `mode: type` | The meeting agent has started (with the mode the screen shows, `type` until the recording is on), and every time the host switches Listen or Type | `/grillo-meeting` | Sets how the room answers the question at hand and the ones after it, until the next mode message (PRD 4.5 item 7). **Type:** the member's next plain message is the answer, recorded with no discussion; the screen writes no slices into this agent's box meanwhile. **Listen:** the agent waits for `use it`. Transcript above a mode line is talk about the question at hand: the agent keeps it for that question's next `use it`. |
| Use it | `use it` | The host presses "Use it", with the transcript chunk already in the input box above it; also the own-time screen, after a pasted or uploaded transcript for the ticket | Every agent | The lines above the control line are the chunk. A grilling agent distils the answer to the question at hand from the chunk (with any talk it kept for that question) and records it, keeping the whole talk word for word as the question's discussion (PRD 4.5 item 7). Any other agent takes from the chunk what fits its own work (PRD 4.5 item 5). An empty chunk records nothing: the agent says nothing was heard. |
| Skip | `skip` | The host presses "Skip question" | `/grillo-meeting` | Leaves the question at hand unanswered and moves to the ticket's next open question; after the last one, leaves the ticket as `done` would and picks the next ticket. Transcript above the line is not recorded as an answer (it stays in the session transcript). |
| Jump | `jump <ticket number>` | The host picks a ticket under "Jump to ticket" | `/grillo-meeting` | `<ticket number>` as in the command arguments (`jump 12`). Leaves the ticket at hand as `done` would, claims that ticket under the store's claim rule and walks its open questions, whatever its domains. A ticket that is closed, not a Grillo ticket, or held by another member is refused (saying who holds it) and the ticket at hand goes on. Transcript above the line is not recorded. |
| Done | `done` | The member presses "Done" on the ticket being answered | `/grillo-answer <ticket number>`, `/grillo-meeting` | Finishes the ticket at hand (PRD 4.4 item 3). Every question answered: the agent writes the decision (the resolution comment and the gist line on the map), closes the ticket and applies the map-done rule. Questions still open: the agent releases the ticket back to the pool, unlocked, its open questions visible. A meeting agent then picks the next ticket; an own-time agent stops. Transcript above the line is not recorded. |

- Messages arrive while the agent may still be working; it handles them in the order they arrive.
- The relay of release 2 (a support agent posting `from Support, for <member>` into another agent's chat) is
  not part of this protocol: it is the support skill's message, not a screen's.

## The map-done rule

The PRD is written the moment the map is done: no open tickets and no fog (PRD 4.7 item 1). Two paths reach
that moment, and both start the PRD writer.

**In a skill.** After every ticket it closes, merges into another ticket or takes the last fog item off, the
agent applies this rule:

1. Read the map issue (the issue labelled `wayfinder:map`) and its `### Fog` section, fresh from GitHub.
2. Read every open ticket: the open issues labelled `wayfinder:grilling`, `wayfinder:research`,
   `wayfinder:prototype` or `wayfinder:task`, every page of them.
3. No open ticket and no fog line: tell the member the map is done and run `/grillo-prd` in the same agent.
4. Otherwise carry on; nothing is written.

**On a screen.** The store's `closeTicket` and `mergeTicket` return `{ mapDone }`, worked out the same way.
When a close or merge from a screen returns `mapDone: true`, that screen starts a grilling agent with the
first message `/grillo-prd`.

- Both paths read GitHub at that moment; neither trusts what it read earlier, since other laptops change the
  map at any time (PRD 6.4).
- Two laptops that close the last two tickets at the same moment may both start the writer. Neither version
  is lost: version numbers follow the numbering rule of `docs/store-layout.md`, so the second one becomes the
  next version.
