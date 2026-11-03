/**
 * Step 3, People: invites, and the member's own role and domains, which the view after accepting an invitation shares
 * (prototype states `people` and `invitee`).
 */
import type { ProjectId } from '../../../main/store/types';
import { badge, button } from '../../theme/components';
import { canInvite, inviteProblem, repositoryToConnect } from './form';
import { cleanDomains } from './membership';
import type { Drafts, WizardContext } from './wizard';
import { el, field, note, pageHead, tag, textInput } from './view';

const LOGIN_SELECTOR = 'input[aria-label="GitHub login to invite"]';

function domainsField(busy: boolean, drafts: Drafts, domains: string[], onChange: (next: string[]) => void): HTMLElement {
  const adding = textInput({
    value: drafts.domain,
    label: 'Add a domain',
    placeholder: 'A domain, for example product',
    disabled: busy,
    onInput: (value) => {
      drafts.domain = value;
    },
  });
  const add = () => {
    const typed = drafts.domain;
    // Cleared before onChange redraws, so the redrawn field starts empty.
    drafts.domain = '';
    onChange(cleanDomains([...domains, typed]));
  };
  adding.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') add();
  });
  return el('div', 'field', [
    'Your domains',
    el('span', 'row', [
      ...domains.map((domain) => tag(domain, busy ? undefined : () => onChange(domains.filter((entry) => entry !== domain)))),
      el('span', 'domain-input', [adding]),
      button('Add domain', { small: true, disabled: busy, onClick: add }),
    ]),
  ]);
}

export function roleAndDomains(
  busy: boolean,
  drafts: Drafts,
  current: { role: string; domains: string[]; prefilledFrom: ProjectId | null },
  onRole: (role: string) => void,
  onDomains: (domains: string[]) => void,
): HTMLElement[] {
  const role = textInput({ value: current.role, disabled: busy, onInput: onRole });
  const parts: HTMLElement[] = [
    el('div', 'grid-2', [field('Your role (free text)', role), domainsField(busy, drafts, current.domains, onDomains)]),
  ];
  if (current.prefilledFrom !== null) {
    parts.push(el('p', 'small muted m0', [`Pre-filled from the last project you joined, ${current.prefilledFrom}.`]));
  }
  return parts;
}

export function peopleHead(): HTMLElement {
  return pageHead(
    'Who is working on this with you?',
    'Invite the people who should take part. Your role and domains (the subjects you know about) tell Grillo which questions to send you.',
  );
}

export function peopleCard(ctx: WizardContext): HTMLElement {
  const { form, busy, drafts, myLogin, root } = ctx;
  const allowed = canInvite(form);
  const addInvite = (): void => {
    drafts.inviteError = inviteProblem(drafts.invite, form.invites, myLogin);
    if (drafts.inviteError === null) {
      form.invites = [...form.invites, drafts.invite.trim()];
      drafts.invite = '';
    }
    ctx.redraw();
    root.querySelector<HTMLInputElement>(LOGIN_SELECTOR)?.focus();
  };
  const login = textInput({
    value: drafts.invite,
    label: 'GitHub login to invite',
    placeholder: allowed ? 'GitHub login, for example member-b' : 'GitHub login',
    disabled: busy || !allowed,
    onInput: (value) => {
      drafts.invite = value;
    },
  });
  login.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addInvite();
  });
  const card = el('div', 'card stack', [
    el('div', 'row', [el('div', 'fill', [login]), button('Invite', { disabled: busy || !allowed, onClick: addInvite })]),
  ]);
  if (!allowed) {
    const repository = repositoryToConnect(form.connectTo);
    const where = repository ? `${repository.owner}/${repository.name}` : 'the repository';
    const why =
      form.access.state === 'known'
        ? `you have ${form.access.permission} access`
        : 'Grillo has not confirmed your access yet (press Check access on the Where step)';
    card.append(el('p', 'reason m0', [`Inviting needs admin rights on ${where}, and ${why}. Ask one of its admins to add people.`]));
  } else {
    card.append(el('p', 'small muted m0', ['An invite is a GitHub repository access invite.']));
  }
  if (drafts.inviteError !== null) card.append(note(drafts.inviteError, 'warn'));

  const me = el('li', '', [
    el('div', 'grow stack', [
      el('div', 'row', [el('span', 'strong', [myLogin ?? 'You']), badge('You', 'info')]),
      ...roleAndDomains(
        busy,
        drafts,
        form,
        (role) => {
          form.role = role;
        },
        (domains) => {
          form.domains = domains;
          ctx.redraw();
        },
      ),
    ]),
  ]);
  const invited = (allowed ? form.invites : []).map((entry) =>
    el('li', '', [
      el('span', 'row', [el('span', 'strong', [entry])]),
      el('span', 'row', [
        badge('Invited on create', 'warn'),
        el('span', 'small muted', ['sets their own role and domains']),
        button('Remove', {
          small: true,
          disabled: busy,
          onClick: () => {
            form.invites = form.invites.filter((name) => name !== entry);
            ctx.redraw();
          },
        }),
      ]),
    ]),
  );
  card.append(el('ul', 'rows', [me, ...invited]));
  return card;
}
