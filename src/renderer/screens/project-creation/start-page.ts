/**
 * The start page (prototype state `start`): the member's projects, the two ways in, and pending invitations.
 */
import type { Invitation, ProjectId } from '../../../main/store/types';
import { asSentence } from '../../../shared/store';
import { badge, button } from '../../theme/components';
import { el, note } from './view';

const DAMAGED_PROJECT_HINT = 'Fix the file on GitHub, then open the project again.';

export interface RecentRow {
  id: ProjectId;
  name: string;
  archived: boolean;
  /** When the member last had it: `opened <date>`, or `created <date>` for one whose folder never opened. */
  when: string;
  /** Why the project's Grillo files or folder cannot be read (prototype state `damaged-project`); null when fine. */
  damaged: string | null;
}

export interface StartData {
  recents: RecentRow[] | { error: string };
  invitations: Invitation[] | { error: string };
}

export interface StartPageActions {
  busy: boolean;
  onNewProject(): void;
  onConnectExisting(): void;
  onOpen(project: ProjectId): void;
  onAccept(invitation: Invitation): void;
}

const date = (iso: string): string => iso.slice(0, 10);

function waysIn({ busy, onNewProject, onConnectExisting }: StartPageActions): HTMLElement {
  return el('div', 'way-ins grid-2', [
    el('div', 'way-in', [
      button('New project', { variant: 'primary', disabled: busy, onClick: onNewProject }),
      el('p', 'small muted m0', ['Grillo makes a new repository (a shared folder on GitHub) for it.']),
    ]),
    el('div', 'way-in', [
      button('Connect existing', { disabled: busy, onClick: onConnectExisting }),
      el('p', 'small muted m0', ['Use a repository you already have on GitHub.']),
    ]),
  ]);
}

function projectsCard(recents: StartData['recents'], actions: StartPageActions): HTMLElement {
  const card = el('div', 'card stack', [el('h3', 'm0', ['Your projects']), el('p', 'small muted m0', ['Recently opened first.'])]);
  if (!Array.isArray(recents)) card.append(note(recents.error, 'err'));
  else if (recents.length === 0) {
    card.append(el('p', 'muted m0', ['No project opened on this laptop yet. Create one, or accept an invitation.']));
  } else {
    card.append(
      el(
        'ul',
        'rows',
        recents.map((recent) =>
          el('li', '', [
            el('div', 'grow', [
              el('span', 'strong', [recent.name]),
              ...(recent.archived ? [' ', badge('Archived')] : []),
              ...(recent.damaged === null ? [] : [' ', badge('Damaged', 'warn')]),
              el('br', ''),
              el('span', 'small muted', [`${recent.id} · ${recent.when}`]),
              ...(recent.damaged === null ? [] : [el('br', ''), el('span', 'reason', [`${asSentence(recent.damaged)} ${DAMAGED_PROJECT_HINT}`])]),
            ]),
            button('Open', { small: true, disabled: actions.busy, onClick: () => actions.onOpen(recent.id) }),
          ]),
        ),
      ),
    );
  }
  card.append(waysIn(actions));
  return card;
}

function invitationsCard(invitations: StartData['invitations'], { busy, onAccept }: StartPageActions): HTMLElement {
  const card = el('div', 'card stack', [el('h3', '', ['Pending invitations'])]);
  if (!Array.isArray(invitations)) card.append(note(invitations.error, 'err'));
  else if (invitations.length === 0) card.append(el('p', 'muted m0', ['No pending invitations.']));
  else {
    card.append(
      el(
        'ul',
        'rows',
        invitations.map((invitation) =>
          el('li', '', [
            el('div', 'grow', [
              el('span', 'strong', [invitation.repository.name]),
              el('br', ''),
              el('span', 'small muted', [
                `${invitation.repository.owner}/${invitation.repository.name} · invited by ${invitation.inviter} on ${date(invitation.createdAt)}`,
              ]),
            ]),
            button('Accept', { variant: 'primary', small: true, disabled: busy, onClick: () => onAccept(invitation) }),
          ]),
        ),
      ),
    );
  }
  card.append(el('p', 'small muted m0', ['Accepting takes the GitHub repository invite in one click; you then set your role and domains.']));
  return card;
}

export function startPage(data: StartData, actions: StartPageActions): HTMLElement[] {
  return [projectsCard(data.recents, actions), invitationsCard(data.invitations, actions)];
}
