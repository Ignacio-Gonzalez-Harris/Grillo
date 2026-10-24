# The release-1 demo

This folder holds the fixed materials for the demo that is the acceptance bar for release 1 (PRD section 11, "The
demo as the acceptance bar"). Release 1 is done only when every check below holds, on all three laptops. The PRD is
the source of truth: if this page and the PRD ever disagree, the PRD wins and this page is fixed.

**Everything in this folder is invented.** Ana, Ben and Carla are the PRD's made-up cast; Quillfeather Tea Co., the
Teacup Building and the rooms do not exist. Never replace any of it with real names, emails, rooms or companies.

## Materials

| File | What it is | Used in |
|---|---|---|
| [`kickoff-transcript.md`](kickoff-transcript.md) | A made-up kick-off chat (about 14 minutes) between Ana, Ben and Carla about an app to book meeting rooms. | Step 3: Ana pastes it as the idea. |
| [`what-we-want.md`](what-we-want.md) | One page of agreed answers: rooms, booking rules, who may book, integrations wanted, out of scope. | Steps 7, 8 and 10: every answer comes from it. |
| The customer email below | A made-up email that clashes with one answer on the sheet. | Step 9: Ben pastes it into a generic agent. |

## How it runs

- **Cast:** three members on three laptops, each with a different domain.
  - **Ana**: domain *product*; she is the host.
  - **Ben**: domain *developer*.
  - **Carla**: domain *platform*.
- **Laptops:** at least one is a Mac and one is Windows. Each has Claude Code signed in with that member's own Claude
  subscription, and the GitHub command-line tool `gh` installed. Each member has a company GitHub account in the
  company's GitHub organisation.
- **Carla's phone:** Carla also needs the GitHub phone app, signed in, for step 8.
- **Install:** Grillo is installed from the unsigned installers, so the Mac and Windows installs include the warning
  click.
- **Before step 1:** Carla is signed out of GitHub on her laptop; Ana and Ben are signed in.
- **Style:** one sitting of about an hour. Every answer follows [`what-we-want.md`](what-we-want.md), so runs stay
  comparable. The AI writes different tickets each run, so every check looks at behaviour, never at exact wording.
- **For step 9 to have a clash:** the question about the longest booking (2 hours on the sheet) must be answered
  before step 9. If no ticket asks it by then, the member answering any booking-rules question includes it.

## The script

Steps and pass conditions are copied from PRD section 11. A step passes only when what the Pass column says is seen.

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
| 11 | **PRD check.** | Decision statements carry source codes like `[S4, Q12]`, unsupported ones are marked `[no source]`, an audit appendix exists, and one line traces back to Carla's phone answer. |
| 12 | **Version.** A member edits the PRD structure and regenerates. | Version 2 exists, and version 1 is kept, numbered and dated. |
| 13 | **Close.** Ana closes the project. | The repository is archived. |

## The customer email (step 9)

Ben pastes the text below into a generic agent. It clashes with the sheet's rule "longest booking 2 hours". The
resolution to choose, so runs stay comparable: **Lighthouse may be booked for up to 4 hours; every other room keeps
the 2-hour limit.**

> Subject: Half-day workshops in the Lighthouse room
>
> Hello,
>
> We are one of Quillfeather's customers and we come to the Teacup Building every month for a half-day workshop with
> your sales team. We heard the new room app will only allow bookings of two hours. Our workshops run from 09:00 to
> 13:00 in the Lighthouse room, and splitting them into two bookings means someone else could take the room halfway
> through. Could the Lighthouse room be booked for a whole morning?
>
> Kind regards,
> The workshop team at Brindlewick Biscuit Makers (a made-up customer)
