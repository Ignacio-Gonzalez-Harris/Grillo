# Grillo — Product Requirements Document (PRD) v1

**Status:** v1, written 2026-10-22 from the finished wayfinder map "Grillo: the way to a full-vision PRD" (GitHub issue 3). Every decision statement ends with a code such as `[T4]` that names the map ticket where it was decided; the appendix lists every code. A statement no ticket supports is marked `[no source]`.

**What Grillo is in one line:** a desktop app that takes an individual or a team from the first statement of an idea, through a guided grilling of the right domain experts, to a finished, traceable and graded PRD `[T3]`.

**The name:** Grillo is a grill engine, and "cricket" in Spanish `[T3]`.

---

## 1. Problem

Today a product idea becomes a PRD through long grilling sessions. Three things go wrong `[T3]`:

1. **Sessions need every expert in the same room for hours**, including people whose questions have nothing to do with them.
2. **Answers are recorded by one person typing.**
3. **The conversation and discussion around the answers is lost.**

Today's rudimentary process, which Grillo reproduces as a workflow but not as a set of tools: the wayfinder skill (a Claude Code skill that splits a big idea into decision tickets and keeps its state on an issue tracker) cuts the idea into tickets; answers are typed by hand, taken from a Granola transcript (Granola is a meeting-recording tool), or tickets are sent to experts who answer in their own time with Claude Code and wayfinder; at the end the whole Granola conversation is dumped so agents have every detail before writing the PRD `[T3]`.

### 1.1 Fixed rules (not up for discussion)

- **No online third-party AI models.** A member's own Claude subscription, used through Claude Code on their own laptop, is the one accepted route `[T3, T40]`.
- **Everything happens inside the app.** Grillo offers a way of working similar to today's process without third-party services such as Granola `[T3]`.
- **The wayfinder skill and its sub-skills are the grilling engine.** An agent is a visible Claude Code session running on the member's own laptop; Grillo starts it in the project folder, ships the skill files there and types the first message. That plumbing is the only hidden part `[T3, T21]`.
- **Claude Code is a hard requirement for every member.** No Claude Code signed in with the member's own Claude subscription (any plan), no Grillo `[T8, T40]`.
- **Questions and answers live in Grillo's own store, whose first backend is GitHub Issues**, one repository per project: in the member's GitHub organisation, or under the member's own GitHub account, private or public (owner's decision, 2026-11-03). Every member needs a GitHub account and the GitHub command-line tool `gh` signed in `[T21]`.
- **Organisation data never sits on a non-company host at rest**, unless a member puts a project under their own GitHub account (owner's decision, 2026-11-03): its data then sits in that account, and **a public project exposes its data: its transcripts, answers and PRD are visible to anyone**. It still reaches Anthropic through each member's own Claude Code subscription; that is accepted `[T21]`.

### 1.2 Wanted outcomes

- Works for individuals and for groups, in person and in virtual meetings `[T3]`.
- Used by many business units, with nothing central to run `[T3, T10]`.
- Every question reaches the right expert through domain tags `[T3, T7]`.
- In a live meeting, the questions asked depend on who is present `[T3, T13]`.
- A grader scores the finished PRD from 0 to 10 and says what to improve and how `[T3, T15]`.
- Every line of the PRD traces back to who said it, when and where `[T27]`.

---

## 2. Users and roles

- **One kind of person: the member.** A project has members and nothing else. Every member can start a project, invite people, answer any question, discuss, export the PRD and close the project. No expert, facilitator, owner, reader or administrator role `[T4]`.
- **Equal but named.** Grillo records who did each thing ("closed by Ben"), and any member can undo any action, including a close. Disagreements are settled by people talking, not by the app `[T4]`.
- **Domain is a tag, not a power.** A member's domains decide which questions reach them first; they never limit what the member may do `[T4, T7]`.
- **Alone is a team of one.** A solo project is an ordinary project with one member, who receives every question whatever its domain. There is no separate solo mode `[T4]`.
- **PRD readers are not Grillo users.** Anyone who only needs the finished PRD gets it as an exported document `[T4]`.
- **Nobody sits above a project, ever.** No administrator, no unit-wide view, no business unit. A project is visible only to its members. The company's GitHub organisation does any grouping `[T4, T29]`.
- **Who the first users are:** a pilot of about ten colleagues the owner knows personally, then every colleague in the company once the pilot passes `[T39, T42]`. K2, a business unit building medical-device software, needs provenance for every decision and its own PRD section structure `[T26, T27]`.

---

## 3. Vocabulary

One name per thing. These are the words the screens, the data model and this document use `[T5]`.

| Name | What it is |
|---|---|
| **Project** | The whole thing from first idea to finished PRD. It stays in the app afterwards, visible to its members `[T5]`. |
| **Member** | A person signed in with their company GitHub account (login, name, email come from GitHub), plus a free-text role and one or more domains kept by Grillo `[T5, T31]`. |
| **Domain** | A free-text subject tag a member gives themselves ("developer", "product", "platform", ...). The set of domains the members declared is what tickets can be tagged with `[T5, T7]`. |
| **Map** | The record inside a project of where things stand: destination, settled decisions, fog (questions that cannot be asked precisely yet), out of scope. It is what the engine uses to recover context between sessions `[T5, T24]`. |
| **Ticket** | A group of questions on one topic, as in wayfinder. Every ticket carries a wayfinder kind (grilling, research, prototype, task) and zero or more domain tags `[T5, T6]`. |
| **Question** | One item inside a ticket, put to members by a grilling agent `[T5]`. |
| **Answer** | What members give to a question, typed or distilled from a transcript. Every answer records its sources `[T5, T11, T27]`. |
| **Discussion** | The talk around an answer, kept word for word `[T5, T12]`. |
| **Source** | Where a decision came from: a live meeting, an own-time answer, an email or pasted text, or a document or research finding, each with who, when and where `[T27]`. |
| **Grilling session** | A live get-together, in a room or on a call, where members answer out loud `[T5]`. |
| **Agent** | A Claude Code session running on the member's laptop, shown inside Grillo. Six kinds: **grilling** (asks questions; several may run at once), **research**, **prototype** and **task** (mirror wayfinder's ticket kinds), **support** (a side helper that relays messages between agents) and **generic** (any task outside the wayfinder flow) `[T5, T28]`. |
| **PRD** | The product requirements document a project produces. One fixed name in every project and screen; "Spec Plan" is retired `[T5, T16]`. |
| **PRD structure** | The project's list of PRD sections, each with a name and a one-line note `[T26]`. |
| **PRD version** | One numbered, dated generation of the PRD, with its score and its audit appendix `[T26, T27]`. |
| **Score** | The 0-10 mark on a PRD version, with one comment per criterion and per section `[T5, T15]`. |
| **Transcript** | The written-down speech of a conversation: a grilling session, or the discussion segment of one question `[T5]`. |
| **Tagging round** | A member-triggered pass in which an agent gives every open ticket one or more domain tags from the members' domains `[T6, T7]`. |

Not app words: cluster, team, business unit, expert, administrator `[T5, T29]`.

---

## 4. Flows

### 4.1 Setup

1. The member installs Grillo from the download page (unsigned: one warning to click past on Mac and on Windows; signing is not planned, section 8) `[T39, T42]`.
2. Grillo checks that Claude Code and `gh` are installed and signed in. If not, it guides the install and the one-time sign-in, or at minimum says what must be set up `[T8, T21]`.
3. The member signs in with their GitHub account; Grillo shows their GitHub login, name and email `[T31]`.
4. Grillo checks for a newer version at start and while open, and offers to download it; an auto-update setting installs it on the next restart instead (Windows only: unsigned, Mac members install updates by hand, section 8) `[T39, T42]`.

### 4.2 Starting a project

1. A member creates a project. Two ways in: Grillo creates a new repository, or the member connects an existing repository (a team's code repository, an empty one, or an earlier Grillo project) `[T21, T44]`. A new repository goes in one of the member's GitHub organisations, always private, or under the member's own GitHub account, private unless they choose public. With no organisation the own account is preselected. **A public project exposes its data: its transcripts, answers and PRD are visible to anyone.** Grillo warns of this when Public is chosen, and in a public project a comment from someone who is not a collaborator is never treated as an answer (owner's decision, 2026-11-03).
2. The member picks the PRD structure: Grillo's shipped default or the structure of an earlier project they belong to, then edits it (add, remove, rename, reorder sections). With no choice made, the default applies `[T26]`. The shipped default has 13 sections: Problem; Users and roles; Vocabulary; Flows; Screens; Data model; Permissions; Build decisions; Design system; Do-not-build list; Acceptance demo; Release order; Assumptions `[I1]`.
3. The member invites people; an invite is a repository access invite. Each invitee sets their free-text role and domains, pre-filled from the last project they joined `[T10, T21, T31]`. Grillo lists the member's pending invitations and accepts one with a click `[I1]`.
4. The member gives the idea: written text (typed or pasted, with text documents attachable; PDF and Word documents are not read) or a recorded conversation's transcript pasted or uploaded `[T6, T11]`.
5. The destination is always a PRD; Grillo never asks what "done" looks like `[T6]`.
6. Grillo opens a grilling agent in the project folder and types the first message (`/grillo-wayfinder <source file>`, the idea having been saved first as source S1). The engine creates the map, the tickets and their questions alone, using frontier, fog and out of scope exactly as wayfinder does today. No conversation is needed before tickets exist `[T6, T21]`. In release 1 tickets of every kind are created, but only grilling agents run; research, prototype and task tickets are worked by members as grilling until release 3 `[I1]`.
7. Tickets are live and editable from the moment they exist: members can edit, merge, close as out of scope or add tickets at any time. No approval gate `[T6]`.

Connecting an existing repository `[T44]`:

- Write access is enough. Actions GitHub reserves for admins (inviting, archiving, settings) are greyed out with the reason.
- Grillo adds its labels, the map issue and its tickets, and one Grillo folder on the main branch. How saves reach main follows the repository's own rules (direct save, or a pull request where main is protected), not Grillo's.
- Existing issues are ignored: Grillo sees only its own map and tickets.
- One Grillo project per repository. If the repository already holds one, Grillo opens it instead of starting a new one.
- Issues must be turned on; if they are off, Grillo says so.

### 4.3 Routing a question to the right expert

1. Tickets are created without domain tags. Any member runs a **tagging round** at any time; an agent reads each open ticket and gives it one or more domains from the members' declared domains. A ticket that fits nobody gets a visible "no domain" tag and is open to anyone. The round is rerun as members join `[T6, T7]`.
2. Members can change tags by hand at any time `[T7]`.
3. Tags are a filter, never a wall: every member can open, read, discuss and answer every ticket `[T7]`.
4. A ticket reaches a person in one of three ways `[T7]`:
   - **War room**: a live grilling session; present members answer the tickets of their domains together.
   - **Solo**: a member takes a ticket under their own name.
   - **Send**: a member sends a ticket to another member.
   Taken or sent means assigned and locked: nobody else can take it. Locked only removes it from the others' to-do lists; everyone can still read and discuss it.
5. Any member can reassign an unanswered ticket from the ticket-and-question management screen `[T7]`.
6. A grilling agent that starts a ticket assigns it to itself, like a person taking it. Assignment is atomic in the store, so two laptops cannot both take one ticket `[T13, T21]`.

### 4.4 Answering in your own time

1. The member opens Grillo and sees their list: tickets they took or were sent first, then everything else filtered by their domains. Nothing is hidden `[T8]`.
2. Per ticket the member chooses: chat with a grilling agent (follow-up questions; answer and discussion written down) or form-style answers typed directly `[T8]`.
3. Each question turns "answered" as it is answered. The member clicks **done** on the ticket. If questions remain, the ticket returns to the pool unlocked with the open questions visible `[T8]`.
4. Grillo nudges about tickets taken but silent for days (release 2) `[T8, T16]`.
5. **Answering from a phone or browser:** a member writes their answer as a comment on the ticket in GitHub's own web or phone app. When any member opens desktop Grillo, their agent may turn that comment into the recorded answer and click done, even on a ticket taken by or sent to someone else. A pickup never unlocks the ticket: with questions still open, it stays with its assignee. The source is "member, via GitHub, date"; Grillo names who recorded it; any member can undo it `[T32]`.

### 4.5 The live grilling session

1. A **host** starts the session on their laptop and ticks who is present from the member list. Presence is used only to pick tickets; the host can change it at any time `[T13]`.
2. **Consent before recording.** The host ticks "everyone here agreed"; Record stays disabled until then. Grillo shows a one-line script to read aloud ("This call is recorded and transcribed by Grillo") and a red "Recording" banner on the host's screen. Meeting platforms show nothing, because Grillo records on the host's laptop; no connection to any meeting platform is built `[T35]`.
3. The host shares their screen (projector in a room, screen share on a call) and holds the controls: Listen / Type per question, "use it", skip, jump to another ticket `[T13]`.
4. **Recording and transcription are local.** Grillo captures the room microphone or the call audio on the host's laptop (the host chooses the source on the meeting screen, one source per session, fixed while recording) and turns it into text on that laptop with an open speech model of the Whisper family. No audio or text leaves the machine for transcription `[T11, T18, T25]`.
5. **One global recording switch** turns the session recording on or off; that recording is the session transcript. **Each agent tab has an "Open channel" switch**; while open, that agent receives the transcript, live as it is spoken (assumed feasible on an ordinary CPU; see section 13) with a fallback of one chunk at "use it". Live delivery writes each slice into the agent's input box as it is spoken; one message is sent at "use it" `[I1]`. Several channels may be open at once; each agent picks out what fits its ticket `[T22, T25]`.
6. **Order.** The grilling agent picks the next unblocked ticket whose domain matches someone present ("no domain" counts as everyone's) and walks its questions one at a time, then the next ticket. Tickets of absent domains stay in the list `[T13]`.
7. **Per question, the room picks a mode** `[T11]`:
   - **Type**: a member types the answer; no discussion is captured.
   - **Listen**: Grillo transcribes while people talk; when a member presses "use it", the agent distils the answer from the transcript and keeps the whole talk as the question's discussion. A person alone uses Listen too; there is no separate dictate mode.
8. **Drift** is handled as wayfinder does: the agent answers the question at hand and may create new tickets or questions from what else was said `[T12, T13]`.
9. Research and task agents can run during the session, and present members may open more grilling agents in parallel. Other members may work other tickets in their own Grillo meanwhile; they do not see the host's screen live. Assignment is the protection against double work `[T13]`.
10. **Speaker labels** (who said what) are not in release 1: automatic labels misattribute about a quarter of speech on a room microphone. "Use it" ties answers to people; the session transcript has no speaker names `[T25]`.
11. **Importing an outside transcript** (Granola, Teams, a file) is a plain paste or upload, for a project start or for a ticket; it is treated as Listen without the recording `[T11]`.

### 4.6 Agents on screen

1. Every agent can be shown as a **chat view**: message bubbles, clickable answer buttons and a message box, with a **"show terminal" switch** that reveals the raw Claude Code output underneath (the machine-readable event stream, since the chat view runs Claude Code without a terminal `[I2]`). Release 1 ships the plain terminal only; the chat view arrives in release 2 `[T22, T16]`. The terminal stays the default for good: the chat view is opt-in, through a start-up setting (`GRILLO_AGENT_RUNTIME=chat`) with no switch in the app (owner's decision, 2026-10-29); the Agent SDK terms are not being checked, so a member who turns the chat view on carries that unchecked risk (owner's decision, 2026-11-03).
2. Agents sit in **tabs** along the top of the project, named "kind · current ticket" ("Grilling · Login flow"), renamed as the agent moves on; a dot on a tab means the agent is waiting for you `[T22]`.
3. Typing is always available; with a channel open, the live transcript also appears in the tab's type box `[T22]`.
4. The meeting controls (present-member ticks, Listen/Type, "use it", skip/jump, transcript strip, consent tick, red banner) sit on the grilling agent's own tab; there is no separate session screen `[T22, T35]`.
5. **Agents share no memory and push nothing to each other.** Each knows: the project's GitHub store, the project folder with the shipped skills, its own chat, the transcript while its channel is open, and the member's own user-level `CLAUDE.md` (personal rules file) `[T23]`.
6. **Before recording an answer, every agent re-reads the map and the related tickets** and checks for contradictions with what was settled meanwhile; if it finds a clash it asks the member further questions before recording `[T23]`.
7. The **support agent** relays by posting into the target agent's chat, marked "from Support, for <member>" (release 2). Relays need the chat view (item 1). Its tab is always on the tab bar, as the first agent tab `[T23, T16]`.
8. How an agent talks comes from the member's own `CLAUDE.md`; a one-off change is told to one agent and reaches no other `[T23]`.
9. **Generic agent.** Opened with a "+" on the tab bar; the member names the tab. The member pastes the material (a customer email, their own words) and says where it comes from, who sent it and when. The agent may change anything the engine can (add sources, open tickets, record or change answers, edit fog) after showing clashes and asking. Every change is marked "<member>, via generic agent, <date>"; the email becomes a source; the conversation is kept word for word as the discussion of each answer recorded. With no written source, the member's own words are the source: name, date, how they heard it, exact words `[T28]`.

### 4.7 Writing, tracing and grading the PRD

1. **Trigger: automatic.** The PRD is written the moment the map is done: no open tickets, no fog `[T14]`.
2. **Input: everything.** All answers, all question discussions and all session transcripts, worked through in stages because the input is large `[T12, T14]`.
3. **Structure: the project's own.** The AI writes the PRD in the project's PRD structure. Any member can change the structure at any time and regenerate; a new section makes the engine add tickets or fog, so the map is not done until every section can be written `[T26]`.
4. **Output:** Markdown stored in the project, readable in Grillo and exportable as a document. Export formats: Markdown and self-contained HTML `[I1]`. Every version is kept, numbered and dated, each openable and downloadable `[T14, T26]`.
5. **Trace.** Every statement that states a decision ends with codes such as `[S4, Q12.3]` (source 4, question 3 of ticket 12); a question code is `Q<ticket issue number>.<k>` `[I1]`. Each version ends with an audit appendix listing every source and question it cites in full: who, when, where, exact words. Codes are stable across versions. A statement no answer supports is marked `[no source]` and listed as unsourced, so a reviewer can confirm it (which turns it into an answer with a source) or remove it `[T27]`.
6. **Feedback loop.** A member opens an agent and says what is wrong; the agent edits the PRD or opens new tickets; when those close the PRD is regenerated as a new version. No approval state: nobody signs it off inside Grillo `[T14]`.
7. **Score (release 3).** 0-10, two halves of equal weight: **quality** (clear, complete, verifiable, tied to objectives, consistent, feasible, needs-not-solutions, scope and priorities, from ISO/IEC/IEEE 29148, INCOSE and product-management guides) and **coverage** (does each section of the project's structure hold real decisions rather than gaps). Equal weight across criteria to start. The member sees a number per criterion and per section, each with one comment: what is weak, why, and a concrete suggestion. It runs on every generation and can be rerun. Nothing is automatic after a low score; the score is guidance, not a gate `[T15, T20, T16]`.
8. **Hand-over.** Grillo stops at the exported PRD. Developers cut it into tickets with their own tool outside Grillo `[T41]`.

### 4.8 Closing a project

Any member closes the project; closing archives its repository: everything stays readable, nothing can change, and any member can unarchive it to reopen `[T31]`. Transcripts stay as long as the repository exists, archived projects included; removing someone's words on request is a manual git-history rewrite, not a Grillo feature `[T35]`.

---

## 5. Screens

Release 1 has exactly these eight screens, the ones the acceptance walkthrough passes through `[T37]`. A later release's feature that is already merged ships in the same installer (section 12); the walkthrough does not depend on it. Each one implements the screen of the same name in the UX prototype under `docs/ux/prototypes/`, drafted from this PRD in the liquid glass theme before any front-end story is cut `[T37]`.

| # | Screen | Holds |
|---|---|---|
| 1 | **Setup check** | Claude Code and `gh` detected and signed in; GitHub sign-in; guidance for what is missing; update offer; the speech-model update setting (automatic / ask / never) `[T8, T21, T39, T42, I1]`. |
| 2 | **Project creation and invites, with the PRD structure** | New repository or connect an existing one; pick and edit the PRD structure; invite members; role and domains; the idea as text or pasted/uploaded transcript; recent projects, pending invitations accepted with one click, an Owner picker (the member's organisations and own account), with private or public for the own account only and a warning on public (owner's decision, 2026-11-03) `[T6, T26, T31, T44, I1]`. |
| 3 | **The map and its tickets** | Destination, settled, fog, out of scope; the ticket list with kinds, domain tags and assignees; "run tagging round"; the Sources list (every source with its code, who, when, where, full text on open); "Start meeting", which launches the session's grilling agent (one meeting agent per laptop); close and reopen the project `[T5, T6, T7, I1]`. |
| 4 | **Ticket-and-question management** | Per ticket: questions and their answered state, tags (change by hand), take, send, reassign; the member's own list first `[T7, T8]`. |
| 5 | **Meeting screen** (on the grilling agent's tab) | Attendee ticks; consent tick, read-aloud script and red banner; global recording switch; Listen/Type; "use it"; skip/jump; running transcript strip; Open channel per tab `[T13, T22, T35]`. |
| 6 | **Own-time answering** | A ticket answered in a terminal with a grilling agent, or in a form; the done button `[T8]`. |
| 7 | **Generic agent tab** | "+" on the tab bar, member-named tab, the agent in a terminal `[T28]`. |
| 8 | **PRD view with versions and export** | The latest version, the list of kept versions numbered and dated, open and download, the audit appendix, "talk to an agent about this PRD"; edit structure and regenerate; regenerate `[T14, T26, T27, I1]`. |

Release 2 adds the chat view with the "show terminal" switch for screens 5, 6 and 7, opt-in while the terminal stays the default (section 4.6 item 1), and adds the support agent tab and nudges; release 3 adds the score to screen 8 `[T16, T22]`.

---

## 6. Data model

### 6.1 Records

| Record | Fields | Lives in GitHub as |
|---|---|---|
| **Project** | name, repository, PRD structure, members file, closed/archived state | one repository (new, or connected) `[T21, T44]` |
| **Member** | GitHub login, name, email (from GitHub); free-text role, domains (Grillo's) | repository access plus one line in the members file `[T31]` |
| **Map** | destination, notes, settled (one gist line per closed ticket), fog, out of scope | one issue labelled `wayfinder:map` `[T24, T31]` |
| **Ticket** | title, question text, why it matters, assumptions, kind, domain tags, blockers, assignee, state | a native sub-issue of the map; kind as a `wayfinder:*` label; domains as labels (plus "no domain"); blockers as GitHub's native relation plus a body section; assignee is the claim `[T31]` |
| **Question** | text, answered state | part of the ticket; answered through comments `[T31]` |
| **Answer** | text, who recorded it, when, sources, "via GitHub" / "via generic agent" marks | a comment on its ticket `[T27, T28, T31, T32]` |
| **Discussion** | word-for-word transcript segment, link to the session file it was cut from | a comment on its ticket `[T12, T31]` |
| **Decision** | the ticket's final answer | a resolution comment, the ticket closed, one gist line on the map `[T31]` |
| **Grilling session** | date, who was present, who ticked consent and when, full transcript | a file in the Grillo folder `[T12, T31, T35]` |
| **Source** | kind (meeting, own-time answer, email or pasted text, document or research finding); who, when, where; the text or segment; a stable code `S<n>` | a file in the Grillo folder `[T27, T31]` |
| **PRD structure** | ordered sections, each a name and a one-line note | a file in the Grillo folder `[T26, T31]` |
| **PRD version** | number, date, Markdown body with `[S, Q]` codes, audit appendix, score | a file per version in the Grillo folder `[T26, T27, T31]` |
| **Score** | overall 0-10; per criterion and per section a number and one comment | stored with its PRD version `[T15, T31]` |

Nothing is stored above the project: no business unit, no cross-project record `[T29]`.

### 6.2 Why files for the long things

A GitHub comment holds about 65,000 characters, which a one-hour transcript nearly fills; files have no size limit and every change is kept `[T31]`.

### 6.3 Store interface

Grillo's screens read and write GitHub through **one store interface** in Grillo's code, so a second backend (a company-hosted service, local storage) can replace GitHub later behind the same interface. Agents talk to the store through `gh` directly in release 1; named tools for agents (an MCP server: a standard way to give an AI tool a fixed set of actions such as read map, create ticket, claim, save answer) are built only when a second backend arrives `[T10, T21]`.

### 6.4 Sharing between laptops

GitHub is the single truth; each member's Grillo reads it on demand. No live sync, no live view across laptops `[T13, T21]`.

---

## 7. Permissions

- **Sign-in is with GitHub.** Authentication and organisation membership are GitHub's job; a member need not belong to an organisation, since a project may live under their own GitHub account (owner's decision, 2026-11-03) `[T29, T31]`.
- **A project is visible only to its members** (the repository's collaborators) `[T4, T31]`.
- **In a repository Grillo creates in an organisation, every member is a repository admin**, so every member can invite, close and reopen `[T31]`. **A repository under a personal account has only an owner and collaborators**: only the owner can invite, close and reopen, and every other member sees those actions greyed out with the reason (owner's decision, 2026-11-03).
- **In a connected repository, write access is enough**; admin-only actions are greyed out with the reason `[T44]`.
- **Every member can see and change everything** inside the project. GitHub's history of issues and files is the "who did what" record and the undo trail `[T4, T31]`.
- **Grillo holds no credentials.** Claude Code and `gh` are signed in by the member; Grillo never stores, routes or intermediates Claude or GitHub tokens `[T17, T21, T39]`.
- **Recording consent** is the host's tick "everyone here agreed", recorded per session with who ticked and when. No per-person consent, no guest accounts `[T35]`.
- **Risk, not legal advice:** recording-consent law differs by country. The owner accepted this risk on 2026-10-29 with no legal review: the host's per-session tick ("everyone here agreed") is trusted, as in comparable note-taking tools `[T35]`.

---

## 8. Build decisions

| Decision | Choice |
|---|---|
| Form | Desktop app, Windows and Mac from release 1, one shared codebase `[T9]`. |
| Toolkit | **Electron**: system-audio capture is documented on Windows (loopback) and on macOS 14.2+ (CoreAudio tap; a missing permission fails silently, so Grillo checks it itself); embedded terminal from **xterm.js + node-pty**. Tauri lacks an official terminal plugin. Fallback: fork dockterm or multiagent-terminal (both permissive licences) if building the terminal proves slow `[T36]`. Decided: Mac call audio uses Electron's built-in loopback capture (Electron 39+, CoreAudio tap on macOS 14.2+) with `NSAudioCaptureUsageDescription`; a missing permission yields an already-ended track with no error, so Grillo checks the track state and tells the host; fallback only if the Mac test fails: a small in-house Swift helper writing tap audio to stdout `[I2]`. |
| Agent runtime | The member's unmodified local Claude Code, signed in with their own subscription (any plan). Grillo launches it in the project folder, ships the skills there and types the first message. The chat view (release 2) needs Claude Code's machine-readable mode or the Agent SDK; the stack decision confirms that every wayfinder prompt comes through it and that the member's user-level `CLAUDE.md` still loads `[T17, T21, T22, T23]`. Decided: Grillo drives the member's own installed `claude` in machine-readable mode (`stream-json` in and out, `--permission-prompt-tool stdio`, never `--bare`), one process per agent tab, behind one swappable driver interface; clickable options and permission prompts arrive as control requests and are answered on stdin; the support relay writes a message into the target agent's stdin; the Agent SDK remains the alternative behind the same interface `[I2]`. The plain terminal agent stays behind one runtime choice and is the default for good, even after the chat view lands in release 2 (section 4.6 item 1; owner's decisions, 2026-10-29 and 2026-11-03): the chat view is opt-in, and the Agent SDK terms are not being checked. The support relay needs the chat runtime: with the terminal default, the support tab opens but no relay is read (reconcile of 2026-10-29). |
| Shipped skill | The wayfinder skill and sub-skills ship inside the project folder Grillo creates on each laptop. Grillo's copy adds one step: a contradiction check against the map before recording an answer, with follow-up questions to the member `[T21, T23]`. |
| Speech-to-text | A Whisper-family model run locally (prototype used faster-whisper, 8-bit, `small.en` / `base.en`; whisper.cpp runs on both systems). 5-second slices for live delivery with a small queue for outlier slices `[T18, T25, T36]`. The model is downloaded on first use; a setting offers automatic, ask or never for model updates `[I1]`. |
| Speaker labels | Not in release 1; later, once a better local model exists `[T25]`. |
| Store | Company GitHub Issues, one repository per project, through `gh`; one swappable store interface in Grillo's code; MCP tools deferred until a second backend `[T21, T31]`. |
| Other models | None in this PRD: no laptop model, no company-paid account or gateway `[T40]`. |
| Distribution | Windows and Mac installers on GitHub Releases of Grillo's own repository, which stays on the owner's personal account and is **public** from the pilot on, with a GitHub Pages site (what Grillo is, how to install and use it, downloads) `[T39, T42]`. A new version is published there automatically after a merge to `main` that changes the app, once CI on `main` is green, with both installers and the update files installed apps read (see CI; owner's decision, 2026-11-03). |
| Signing | Release 1 pilot ships unsigned (about ten colleagues; one warning to click past) `[T39, T42]`. Signing is not planned (owner's decision, 2026-11-03): installers stay unsigned, people click past the Windows and Mac warnings, and Mac members install updates by hand; it is revisited if company IT blocks unsigned apps or before a company-wide release. |
| Updates | Grillo checks for new releases while open and shows a pop-up offering to install; an auto-update setting installs on the next restart (Windows only: unsigned, Mac members install updates by hand, see Signing) `[T39, T42]`. |
| CI | GitHub Actions on GitHub-hosted **Windows and Mac** runners: every pull request runs build, lint and tests on both; installers are built only for a version being published. A version is published automatically after a merge to `main` that changes the app, once CI on `main` is green: the latest release's last number plus one, or a higher major or minor set in `package.json`; merges that change only docs, agent rules, the download site or the workflows publish nothing (owner's decision, 2026-11-03) `[T39]`. |
| Hosting | Nothing central: no Grillo server or database `[T10, T43]`. |

Risks carried from the decisions: code written as an employee may belong to the company: the check ran on 2026-11-03 and most commits carry the owner's work email; the owner went ahead and made the repository public, and no written employer clearance is recorded `[T42]`; company IT may block unsigned apps on some laptops (signing not planned, owner's decision, 2026-11-03); an unsigned Mac update may need "Open Anyway" and the audio permission again `[T39]`; `node-pty` must match Electron's native ABI `[T36]`; live delivery uses more of each member's Claude usage than one chunk at "use it" `[T22]`.

---

## 9. Design system

- **Grillo's design system is a "liquid glass" theme** (see-through, frosted panels) for every desktop screen `[T37]`.
- The interface language is English `[I1]`.
- **How the look gets made:** after this PRD and before tickets are cut, Claude drafts a mock-up of the eight release-1 screens in that theme into `docs/ux/prototypes/` (a pull request a human merges). That mock-up produces the colour and spacing token file every front-end story must use; no colour or spacing value outside it goes in `[T37]`.
- Liquid glass is Apple's look; on Windows it has to be imitated, so the mock-up checks it reads well on both systems `[T37]`.
- The target users include experts who are not technical, so release 2's chat view was meant to become the everyday face of an agent `[T22, T16]`; the terminal stays the default for good and the chat view is opt-in (owner's decision, 2026-11-03).

---

## 10. Do-not-build list

Eight "nevers". A future PRD may not add them `[T43]`.

1. **A Grillo web or phone app**, in any release; GitHub's own apps fill that role. The public download and explanation page on GitHub Pages is not a version of Grillo `[T32, T43]`.
2. **Administrators, roles above member, a unit-wide view, or business units** `[T4, T29, T43]`.
3. **Comparing one project's PRD with another's** to find conflicts; each project stands alone `[T29, T43]`.
4. **Approval gates of any kind**: no sign-off before a ticket, an agent's change or a PRD counts `[T6, T14, T28, T43]`.
5. **A direct connection to Granola or any outside meeting recorder**; outside transcripts come in by paste or upload `[T11, T19, T43]`.
6. **A live view across laptops**; assignment prevents double work `[T13, T23, T43]`.
7. **A central Grillo server or database**: only the app on each laptop, plus GitHub `[T10, T43]`.
8. **Online AI gateways such as OpenRouter, or any online third-party model** `[T3, T43]`.

### Out of scope for this PRD (a later PRD may add them)

- **Other models behind Claude Code**: a model on the laptop (for example through Ollama) or a company-paid Claude account or gateway `[T40]`.
- **Sending the PRD's work to an outside tracker** (epics and stories in another repository or in Jira); Grillo stops at the exported PRD `[T41]`.
- **Automatic speaker labels**, until a better local model exists `[T25]`.
- **A second store backend and MCP tools for agents**, until one is needed `[T21]`.

---

## 11. The demo as the acceptance bar

This walkthrough is the acceptance bar for release 1. Release 1 is done only when every check holds, on all three laptops `[T34]`.

**How it runs** `[T34]`

- **Cast:** three members on three laptops, each with a different domain: Ana (product, host), Ben (developer), Carla (platform). At least one laptop is a Mac and one is Windows.
- **Idea:** a small made-up idea, "an app to book meeting rooms", given as a pasted transcript of a short kick-off chat.
- **Style:** one sitting of about an hour. Answers follow a one-page "what we want" sheet about the room app, so runs stay comparable. The AI writes different tickets each run, so every check looks at behaviour, never at exact wording.
- **Materials:** the kick-off transcript and the sheet are written once, with made-up data only.
- **Install:** from the unsigned installers, so the Mac and Windows steps include the warning click `[T39]`.

**The script** (step, then what must be seen) `[T34]`

| # | Step | Pass |
|---|---|---|
| 1 | **Setup.** All three open Grillo; Carla starts signed out of GitHub. | The setup check tells her and guides her in; then Claude Code and GitHub show signed in on all three. |
| 2 | **Project.** Ana creates "Room booking", picks the default PRD structure, adds one section, invites Ben and Carla. | A private repository exists in the company GitHub, and all three see the project. |
| 3 | **Idea.** Ana pastes the kick-off transcript. | A map and at least three tickets with questions appear, in Grillo and as GitHub issues. |
| 4 | **Tagging.** A member runs the tagging round. | Every ticket carries one or more domains or "no domain", also visible as GitHub labels. |
| 5 | **Send and take.** Ana sends a platform ticket to Carla; Ben takes a developer ticket. | All three Grillos show both tickets locked, with their owners. |
| 6 | **Meeting.** Ana hosts and ticks Ben present, Carla absent. | The grilling agent picks only tickets tagged product or developer. |
| 7 | **Meeting answers.** One question by Type, one by Listen and "use it". | Both answers are recorded; the Listen answer keeps its talk as discussion on the question; the session transcript is kept. |
| 8 | **Own time.** Ben answers his ticket by form; Carla comments her answer from the GitHub phone app. | Ana's Grillo picks up Carla's comment and records it with the source "Carla, via GitHub, date", naming Ana as the one who recorded it. |
| 9 | **Generic agent.** Ben opens "+" and pastes a made-up customer email that clashes with a recorded answer. | The clash is shown, Ben resolves it, the change is marked "Ben, via generic agent, date", and the email becomes a source. |
| 10 | **Finish.** The remaining tickets are answered and the map completes. | The PRD is written automatically, in Ana's structure including her extra section. |
| 11 | **PRD check.** | Decision statements carry source codes like `[S4, Q12.3]`, unsupported ones are marked `[no source]`, an audit appendix exists, and one line traces back to Carla's phone answer. |
| 12 | **Version.** A member edits the PRD structure and regenerates. | Version 2 exists, and version 1 is kept, numbered and dated. |
| 13 | **Close.** Ana closes the project. | The repository is archived. |

Later releases get their own demo steps when they are planned `[T34]`.

---

## 12. Release order

**Release 1 — both halves, kept plain. Fixes all three problems.** Ships to the unsigned pilot, then company-wide once the pilot passes `[T16, T39, T42]`; the app stays unsigned until signing is revisited (section 8, Signing). The release order is the build order: nothing in the app is switched off by release, so a later release's feature merged before an installer is published ships in it.

1. Setup check (Claude Code and `gh` signed in), GitHub sign-in, project creation (new repository or connected one) and invites `[T16, T42, T44]`.
2. The PRD structure: pick the default or an earlier project's, edit sections `[T26]`.
3. The engine turns the idea (text or transcript) into the map, tickets and questions; the domain tagging round `[T16]`.
4. Ticket-and-question management: take, send, reassign `[T16]`.
5. Own-time answering with an agent in a plain terminal, or form-style `[T16]`.
6. The live meeting on the grilling agent's tab: consent tick, script and banner; global recording; local transcription; Listen/Type; "use it"; per-tab Open channel with live delivery (fallback: one chunk at "use it"); transcript import by paste or upload `[T16, T35]`.
7. Picking up GitHub comments as answers `[T32]`.
8. The generic agent, in the plain terminal `[T28]`.
9. Source recording on every answer; the PRD written automatically with `[S, Q]` codes, `[no source]` marks and the audit appendix; every version kept; export `[T16, T26, T27]`.
10. Public repository, GitHub Pages site, GitHub Releases, update check and pop-up; CI on Windows and Mac runners `[T39, T42]`.

**Release 2 — friendly** `[T16]`: the chat view with the "show terminal" switch; the support agent and its relay; nudges on silent tickets.

**Release 3 — quality** `[T16]`: the PRD grader; the research, prototype and task agents.

**Later** `[T25]`: automatic speaker labels, once a better local model exists.

Risk: release 1 is the largest of the options offered, so the wait before anyone uses Grillo is the longest `[T16, T26, T27, T28]`.

---

## 13. Assumptions still unverified

Carried from the tickets so nobody mistakes them for facts.

- Members may create private repositories in the company GitHub organisation and grant admin on them `[T21, T31]`.
- GitHub's `author_association` on a comment tells a repository's owner, organisation members and collaborators from everyone else, for a public project; and an invite to a personal repository works with no `permission` value. Both come from GitHub's public documentation and were never tried against real GitHub (owner's decision, 2026-11-03).
- `gh` can be installed and signed in on company laptops without administrator help `[T21]`.
- Signing in to Grillo can reuse the member's `gh` sign-in `[T31]`.
- Claude Code's machine-readable mode or the Agent SDK carries every wayfinder prompt (clickable options, permission prompts) and loads the member's user-level `CLAUDE.md`; and a plain terminal agent's conversation can be captured word for word `[T22, T23, T28]`.
- Grillo's label names do not clash with labels a connected repository already uses `[T44]`.
- Whether an internal server app on a Team or Enterprise Claude login would be permitted is undetermined and not needed by this PRD `[T17]`.
- Transcription speed on an older laptop than the test machine; headset or call audio accuracy; Mac transcription `[T25]`.
- Anthropic's Agent SDK terms say third-party products may not offer claude.ai login without approval and call `claude -p` the SDK via the CLI; whether that wording covers Grillo driving each member's own Claude Code is unsettled `[I2]`; it is not being checked, because the terminal stays the default and only a member who turns the chat view on depends on it (owner's decision, 2026-11-03).
- Electron's Mac loopback capture and its Screen Recording permission behaviour are untested on a Mac; Anthropic may make `--bare` the default for `claude -p`, so Grillo pins the flags `[I2]`.
- 5-second slices transcribe faster than they are spoken on an ordinary laptop CPU, so live delivery keeps up; the first measurement (the pull request for the local transcription engine story, `base.en`) took 3.2 to 4.2 s per 4-second slice on a busy machine, so this is unproven `[I1]`.

---

## Appendix A — Sources (the map tickets)

Every `[T<n>]` code above is GitHub issue `n` in this repository, a ticket of the map "Grillo: the way to a full-vision PRD" (issue 3). All tickets were answered by the map owner between 2026-10-01 and 2026-10-22.

| Code | Ticket | Kind |
|---|---|---|
| T3 | Grillo: the way to a full-vision PRD (the map: destination, fixed rules, wanted outcomes) | map |
| T4 | Who uses Grillo, and in what roles? | grilling |
| T5 | What are the core things in Grillo called? | grilling |
| T6 | How does a grilling start? | grilling |
| T7 | How does a question reach the right expert? | grilling |
| T8 | How does an expert answer in their own time? | grilling |
| T9 | What form does Grillo take? | grilling |
| T10 | How does Grillo reach many business units? | grilling |
| T11 | How are spoken answers captured in a meeting? | grilling |
| T12 | How is the discussion around an answer kept? | grilling |
| T13 | How does a live Grillo meeting run? | grilling |
| T14 | How is the PRD produced from the answers? | grilling |
| T15 | How is a PRD graded from 0 to 10? | grilling |
| T16 | What ships in which release? | grilling |
| T17 | How can an app drive Claude Code on the subscription of each user? | research |
| T18 | How can a meeting be transcribed without an online third-party model? | research |
| T19 | What can Granola export, and how? | research |
| T20 | What established ways exist to judge a PRD? | research |
| T21 | How does the hidden wayfinder engine use Grillo's own store? | grilling |
| T22 | How do members talk to the agents on screen? | grilling |
| T23 | How do several agents work together in one project? | grilling |
| T24 | How do the wayfinder skill and its sub-skills work? | research |
| T25 | Does local transcription with speaker labels work on an ordinary laptop? | prototype |
| T26 | How does a project shape its PRD? | grilling |
| T27 | How does every PRD line trace back to its source? | grilling |
| T28 | How does a generic agent session work outside the wayfinder flow? | grilling |
| T29 | What would business units and cross-project conflict reconciliation cost Grillo? | research |
| T30 | Can Matcha AI run Grillo's agents instead of Claude Code? (not determined; not relied on) | research |
| T31 | What does a Grillo project store, and where does each thing live in GitHub? | grilling |
| T32 | Does Grillo need a browser or phone companion? | grilling |
| T34 | What walkthrough proves release 1 works? | grilling |
| T35 | What consent does Grillo need to record a meeting, and how long is it kept? | grilling |
| T36 | Which desktop toolkit and agent terminal approach does Grillo use? | research |
| T37 | Which design system and which screens does release 1 have? | grilling |
| T39 | How does the Grillo installer reach members' laptops, and which CI builds it? | grilling |
| T40 | Which other ways of running the AI model can a member choose? | grilling |
| T41 | Does Grillo send a finished PRD's work to an outside ticketing system? | grilling |
| T42 | What must happen before Grillo goes company-wide? | grilling |
| T43 | What goes on Grillo's do-not-build list? | grilling |
| T44 | Can a project connect to an existing GitHub repository? | grilling |
| I1 | Interview during /prd-to-tickets on 2026-10-22 | grilling |
| I2 | Decisions recorded after the ticket split on 2026-10-22 (chat driver spike, Mac audio research) | grilling |

Where a later ticket amended an earlier one, this document states the amended decision: Railway as the first store was replaced by GitHub Issues (T21 amends T10); the hidden agent became a visible terminal, then a chat view over it (T21, T22 amend T3); one fixed PRD structure and "latest version only" became a per-project structure with every version kept (T26 amends T14); "Spec Plan" was retired for "PRD" (T16 amends T26, T27); "every member is an admin" is relaxed to write access in connected repositories (T44 amends T31); the private pilot repository became public (T42 amends T39); the agent kinds gained "generic" (T28 amends T5).

Unsourced statements in this document: none found on writing; any reader who finds one marks it `[no source]`.
