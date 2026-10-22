# Grillo UX prototype (PRD v1, release 1)

The eight release-1 screens of `docs/PRDs/PRD.md` section 5, in the PRD's **liquid glass** theme (section 9).

| Screen id | Name | PRD section | What the user does there | States shown |
|---|---|---|---|---|
| `screen-setup-check` | Setup check | 5 row 1; 4.1; 8 (Updates) | Checks Claude Code and `gh` are installed and signed in, signs in to GitHub, takes an update | Checking · Everything missing · Signed out of GitHub · All green, with update offer |
| `screen-project-creation` | Project creation and invites, with the PRD structure | 5 row 2; 4.2; 7 | Creates a project in a new or existing repository, edits the PRD structure, invites people, sets role and domains, gives the idea | New repository · Connect existing, write access only (admin actions greyed) · Connect: repository problems · Joining as an invitee · Creating |
| `screen-map-and-tickets` | The map and its tickets | 5 row 3; 4.2 steps 6-7; 4.3 | Sees destination, settled, fog and out of scope, and the ticket list; runs the tagging round | Engine building the map · Tickets untagged · Tagged and assigned · Map done |
| `screen-ticket-management` | Ticket-and-question management | 5 row 4; 4.3; 4.4 steps 1 and 5 | Works their own list first; changes tags; takes, sends or reassigns a ticket; sees questions and answers | Unassigned ticket · Locked by another member · Answer from a GitHub comment · Empty list |
| `screen-meeting` | Meeting screen (on the grilling agent's tab) | 5 row 5; 4.5; 4.6 items 2-4 | Hosts a live session: presence, consent, recording, Listen or Type, "use it", skip and jump, Open channel per tab | Before consent (Record disabled) · Recording, Listen · Recording, Type |
| `screen-own-time-answering` | Own-time answering | 5 row 6; 4.4; 4.6 | Answers a ticket with a grilling agent in a terminal or in a form, then presses Done | With a grilling agent · In a form · Done with open questions · Done, all answered |
| `screen-generic-agent-tab` | Generic agent tab | 5 row 7; 4.6 item 9 | Opens "+", names the tab, pastes material with its source, resolves clashes in a terminal | Naming the new tab · Pasted email with a clash · Own words as the source |
| `screen-prd-view` | PRD view with versions and export | 5 row 8; 4.7 | Reads the latest PRD with source codes and audit appendix, opens or downloads versions, exports, talks to an agent | No version yet · Writing · Versions list |

Open `index.html` straight from disk in any browser: no build step, no network. The left-hand list switches screens and the "States" buttons switch each screen's states; the "Windows fallback" switch turns off the frosted blur to check readability where it is unavailable.

Front-end stories take every colour and spacing value (and every radius, blur and size) from `tokens.css` and nothing else; `index.html` holds a copy of it.

Front-end stories reference a screen by its id.
