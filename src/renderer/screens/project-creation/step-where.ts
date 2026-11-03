/**
 * Step 1, Where: owner, name and visibility for a new repository, or the repository list with its access check for an
 * existing one (prototype states `new` and `connect-*`).
 */
import type { Permission } from '../../../main/store/types';
import { asSentence } from '../../../shared/store';
import { badge, button } from '../../theme/components';
import { matchingRepositories, ownedByMember, repositoryToConnect, suggestedRepositoryName, type RepositoryMode } from './form';
import type { WizardContext } from './wizard';
import { el, note, pageHead, reasonNote, segmented, textInput } from './view';

const SEARCH_LABEL = 'Search repositories';
const SEARCH_SELECTOR = `input[aria-label="${SEARCH_LABEL}"]`;
export const PUBLIC_WARNING =
  'Public means anyone on the internet can read this project: its transcripts, answers and PRD. Comments from people who are not collaborators are never treated as answers.';
export const READ_ACCESS_HINT = 'Connecting needs write access. Ask one of its admins for it, or pick another repository.';

export const ACCESS_BADGES: Record<Permission, () => HTMLElement> = {
  admin: () => badge('Admin access', 'ok'),
  write: () => badge('Write access', 'warn'),
  read: () => badge('Read access only', 'err'),
};

const idOf = ({ owner, name }: { owner: string; name: string }): string => `${owner}/${name}`;

/** Makes this repository the one to connect; the list already says the access to any repository it holds. */
function chooseRepository(ctx: WizardContext, id: string): void {
  const { form, repositories } = ctx;
  const listed = (Array.isArray(repositories) ? repositories : []).find(({ repository }) => idOf(repository).toLowerCase() === id.toLowerCase());
  form.connectTo = listed ? idOf(listed.repository) : id;
  form.access = listed ? { state: 'known', permission: listed.permission } : { state: 'unchecked' };
  ctx.clearMessages();
}

/** A full `owner/repo` typed is chosen; other typing only narrows the list, and drops a choice that was only typed. */
function searchRepositories(ctx: WizardContext, value: string): void {
  const { form, repositories, root } = ctx;
  form.connectSearch = value;
  const typed = repositoryToConnect(value);
  if (typed !== null) chooseRepository(ctx, idOf(typed));
  else if (!(Array.isArray(repositories) && repositories.some(({ repository }) => idOf(repository) === form.connectTo))) {
    form.connectTo = '';
    form.access = { state: 'unchecked' };
  }
  const caret = root.querySelector<HTMLInputElement>(SEARCH_SELECTOR)?.selectionStart ?? null;
  ctx.redraw();
  const again = root.querySelector<HTMLInputElement>(SEARCH_SELECTOR);
  again?.focus();
  again?.setSelectionRange(caret, caret);
}

function accessRow(ctx: WizardContext, name: HTMLElement): HTMLLIElement | null {
  const { access } = ctx.form;
  if (access.state === 'unchecked') return null;
  switch (access.state) {
    case 'checking':
      return el('li', '', [name, badge('Checking…')]);
    case 'unknown':
      return el('li', '', [el('div', 'grow', [name, el('p', 'small muted m0', [access.message])]), badge('Access not known', 'warn')]);
    case 'known': {
      const row = el('li', access.permission === 'read' ? '' : 'selected', [name, ACCESS_BADGES[access.permission]()]);
      if (access.permission === 'read') row.append(el('p', 'small muted m0 full', [READ_ACCESS_HINT]));
      return row;
    }
  }
}

/** The prototype's list of the member's repositories, then the chosen one on its own when the list does not show it. */
function repositoryList(ctx: WizardContext): HTMLElement[] {
  const { form, repositories, busy } = ctx;
  const parts: HTMLElement[] = [];
  const visible = Array.isArray(repositories) ? matchingRepositories(repositories, form.connectSearch) : [];
  if (!Array.isArray(repositories)) {
    parts.push(note(`Grillo could not list your repositories: ${asSentence(repositories.error)} Type the repository in full as owner/repository instead.`, 'warn'));
  } else if (visible.length === 0) {
    parts.push(el('p', 'small muted m0', [repositories.length === 0 ? 'Grillo found no repository of yours.' : 'No repository of yours matches this search.']));
  }
  const rows = visible.map(({ repository, permission }) => {
    const id = idOf(repository);
    const radio = el('input', '');
    radio.type = 'radio';
    radio.name = 'repo-connect';
    radio.checked = id === form.connectTo;
    radio.disabled = busy;
    radio.addEventListener('change', () => {
      chooseRepository(ctx, id);
      ctx.redraw();
    });
    const label = el('label', 'check', [radio, id]);
    return (radio.checked ? accessRow(ctx, label) : null) ?? el('li', '', [label, ACCESS_BADGES[permission]()]);
  });
  if (!visible.some(({ repository }) => idOf(repository) === form.connectTo)) {
    const repository = repositoryToConnect(form.connectTo);
    const chosen = repository && accessRow(ctx, el('span', 'strong', [idOf(repository)]));
    if (chosen) rows.push(chosen);
  }
  if (rows.length > 0) parts.push(el('ul', 'rows', rows));
  return parts;
}

function connectFields(ctx: WizardContext): HTMLElement[] {
  const { form, busy, reason } = ctx;
  const search = textInput({
    value: form.connectSearch,
    type: 'search',
    label: SEARCH_LABEL,
    placeholder: 'Search your repositories',
    disabled: busy,
    onInput: (value) => searchRepositories(ctx, value),
  });
  return [
    el('div', 'row', [el('div', 'fill', [search]), button('Check access', { disabled: busy, onClick: () => void ctx.checkAccess() })]),
    ...(reason === null ? [] : [reasonNote(reason)]),
    ...repositoryList(ctx),
    el('p', 'note small', [
      "Write access (permission to change the repository) is enough. Grillo adds its labels, its map and tickets as GitHub issues (tracked items on GitHub), and one Grillo folder on the main branch (the repository's main copy). How saves reach the main branch follows this repository's own rules. Issues already there are ignored.",
    ]),
  ];
}

/** A control with the reason it stopped the member right under it. */
function withReason(control: HTMLElement, reason: string | null): HTMLElement {
  return reason === null ? control : el('div', 'stack', [control, reasonNote(reason)]);
}

function newRepositoryFields(ctx: WizardContext): HTMLElement[] {
  const { form, organisations, busy, reason } = ctx;
  const repositoryName = textInput({
    value: form.repositoryName,
    label: 'Repository name',
    disabled: busy,
    onInput: (value) => {
      form.repositoryName = value;
      form.repositoryNameTyped = true;
      ctx.clearReason();
    },
  });
  const projectName = textInput({
    value: form.projectName,
    label: 'Project name',
    disabled: busy,
    onInput: (value) => {
      form.projectName = value;
      if (!form.repositoryNameTyped) {
        form.repositoryName = suggestedRepositoryName(value);
        repositoryName.value = form.repositoryName;
        ctx.clearReason();
      }
    },
  });
  const ownerChoice = (login: string, label: string): HTMLOptionElement => {
    const option = el('option', '', [label]);
    option.value = login;
    option.selected = login === form.organisation;
    return option;
  };
  const owner = el('select', '', [
    ...organisations.map((entry) => ownerChoice(entry.login, entry.login)),
    ...(form.ownAccount === null ? [] : [ownerChoice(form.ownAccount, `${form.ownAccount} (your account)`)]),
  ]);
  owner.disabled = busy || owner.options.length === 0;
  owner.addEventListener('change', () => {
    form.organisation = owner.value;
    form.visibility = 'private';
    ctx.clearReason();
    ctx.redraw();
  });
  const own = ownedByMember(form);
  const noOwner = form.organisation === '';
  const parts: HTMLElement[] = [
    el('div', 'grid-2', [
      el('label', 'field', ['Project name', projectName]),
      withReason(el('label', 'field', ['Owner', owner]), noOwner ? reason : null),
      withReason(el('label', 'field', ['Repository name', repositoryName]), noOwner ? null : reason),
      ...(own
        ? [
            el('div', 'field', [
              'Visibility',
              segmented(
                'Visibility',
                [
                  { value: 'private', text: 'Private' },
                  { value: 'public', text: 'Public' },
                ],
                form.visibility,
                (visibility) => {
                  form.visibility = visibility;
                  ctx.redraw();
                },
                busy,
              ),
            ]),
          ]
        : []),
    ]),
    el('p', 'small muted m0', [
      own
        ? `A ${form.visibility} repository under your own GitHub account. Only you can invite people, close and reopen the project; the people you invite get write access.`
        : 'A private repository in the organisation you pick (the GitHub organisations your sign-in belongs to). Every member becomes a repository admin.',
    ]),
  ];
  if (own && form.visibility === 'public') parts.push(note(PUBLIC_WARNING, 'warn'));
  if (owner.options.length === 0) {
    parts.push(note('Grillo cannot create a repository without an owner. Connect an existing one instead.', 'warn'));
  }
  return parts;
}

export function whereHead(mode: RepositoryMode): HTMLElement {
  return mode === 'new'
    ? pageHead(
        'Where should this project live?',
        'Every Grillo project lives in its own GitHub repository (a shared folder on GitHub). Name your project and choose who owns it.',
      )
    : pageHead(
        'Which repository should this project use?',
        'Pick a repository you already have on GitHub. Grillo works beside what is there and leaves your existing issues alone.',
      );
}

/** The switch between the two ways in, which keeps what was typed for each. */
export function modeSwitch(current: RepositoryMode, busy: boolean, onPick: (mode: RepositoryMode) => void): HTMLElement {
  return segmented(
    'Repository',
    [
      { value: 'new', text: 'Create a new repository' },
      { value: 'connect', text: 'Connect an existing one' },
    ],
    current,
    onPick,
    busy,
  );
}

export function whereCard(ctx: WizardContext): HTMLElement {
  const { form, busy } = ctx;
  return el('div', 'card stack', [
    modeSwitch(form.mode, busy, (mode) => {
      form.mode = mode;
      form.structureOpen = mode === 'new';
      ctx.clearReason();
      ctx.redraw();
    }),
    ...(form.mode === 'new' ? newRepositoryFields(ctx) : connectFields(ctx)),
  ]);
}
