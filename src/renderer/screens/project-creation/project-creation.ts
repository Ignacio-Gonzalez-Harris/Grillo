/**
 * Project creation and invites, with the PRD structure (PRD sections 4.2 and 7, section 5 screen 2; prototype
 * `screen-project-creation`). Opened with no params it shows the member's recent projects and pending invitations,
 * and from there the new-project form. Opened with `{ project: '<owner>/<repo>' }` (from the PRD view) it shows that
 * project's structure editor.
 */
import './project-creation.css';
import type { Store } from '../../../main/store/store';
import { DEFAULT_PRD_STRUCTURE } from '../../../main/store/defaults';
import type { Invitation, Organisation, PrdStructure, Project, ProjectId, RecentProject } from '../../../main/store/types';
import { agentTitle } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import { AGENT_SCREEN } from '../../app/navigation';
import type { ScreenParams } from '../../app/screens';
import { asSentence } from '../../../shared/store';
import { badge, button } from '../../theme/components';
import { REGENERATE_COMMAND, startCreation, type Creation } from './create';
import {
  DEFAULT_STRUCTURE_CHOICE,
  attachmentsFrom,
  canInvite,
  draftOf,
  formProblem,
  inviteProblem,
  newProjectForm,
  repositoryToConnect,
  suggestedRepositoryName,
  type ProjectForm,
} from './form';
import { cleanDomains, readLastMembership, saveLastMembership, type LastMembership } from './membership';
import {
  addSection,
  checkedStructure,
  moveSection,
  removeSection,
  renameSection,
  setSectionNote,
  structureProblem,
} from './structure';
import { el, field, filePicker, messageOf, note, segmented, tag, textInput, type Content } from './view';

/** The project tabs this screen opens (src/renderer/app/navigation.ts, PROJECT_TABS), with `{ project }`. */
export const MAP_SCREEN = 'map';
export const PRD_SCREEN = 'prd';

export interface ProjectCreationDeps {
  store: Store;
  grillo: GrilloApi;
  navigate(screenId: string, params?: ScreenParams): void;
  now?: () => Date;
}

const PROJECT_ID = /^[^/\s]+\/[^/\s]+$/;
const TEXT_FILES = '.txt,.md,.markdown,.csv,.json,.vtt,.srt';
const TRANSCRIPT_FILES = '.txt,.md,.vtt,.srt';
const DAMAGED_PROJECT_HINT = 'Fix the file on GitHub, then open the project again.';

interface RecentRow {
  id: ProjectId;
  name: string;
  archived: boolean;
  lastOpened: string;
  /** Why the project's Grillo files or folder cannot be read (prototype state `damaged-project`); null when fine. */
  damaged: string | null;
}

interface StartData {
  recents: RecentRow[] | { error: string };
  invitations: Invitation[] | { error: string };
}

type ConnectProblem = { repository: ProjectId } & ({ kind: 'grillo-project' } | { kind: 'refused'; message: string });

interface Joined {
  invitation: Invitation;
  project: ProjectId;
  role: string;
  domains: string[];
  prefilledFrom: ProjectId | null;
}

type View =
  | { name: 'loading'; text: string }
  | { name: 'failed'; message: string }
  | { name: 'start'; data: StartData }
  | { name: 'form' }
  | { name: 'problem'; problem: ConnectProblem }
  | { name: 'invitee'; joined: Joined }
  | { name: 'creating'; creation: Creation }
  | { name: 'structure'; project: ProjectId; structure: PrdStructure };

const date = (iso: string): string => iso.slice(0, 10);
const isText = (value: unknown): value is string => typeof value === 'string';
const idOf = ({ owner, name }: { owner: string; name: string }): ProjectId => `${owner}/${name}`;

function listOrError<T>(result: PromiseSettledResult<T[]>, keep: (item: unknown) => item is T): T[] | { error: string } {
  if (result.status === 'rejected') return { error: messageOf(result.reason) };
  return Array.isArray(result.value) ? result.value.filter(keep) : { error: 'Grillo could not read this list from the store.' };
}

function isRecent(value: unknown): value is RecentProject {
  const recent = value as Partial<Record<keyof RecentProject, unknown>> | null;
  return isText(recent?.project) && PROJECT_ID.test(recent.project) && isText(recent.lastOpened);
}

function isInvitation(value: unknown): value is Invitation {
  const invitation = value as Partial<Record<keyof Invitation, unknown>> | null;
  const repository = invitation?.repository as { owner?: unknown; name?: unknown } | null | undefined;
  return (
    typeof invitation?.id === 'number' &&
    isText(repository?.owner) &&
    isText(repository.name) &&
    isText(invitation.inviter) &&
    isText(invitation.createdAt)
  );
}

function isProject(value: unknown): value is Project {
  const project = value as Partial<Record<keyof Project, unknown>> | null;
  return (
    isText(project?.id) &&
    isText(project.name) &&
    typeof project.archived === 'boolean' &&
    (project.damaged === undefined || isText(project.damaged))
  );
}

function isOrganisation(value: unknown): value is Organisation {
  return isText((value as { login?: unknown } | null)?.login);
}

export function mountProjectCreation(container: HTMLElement, params: ScreenParams, deps: ProjectCreationDeps): () => void {
  const { store, grillo, navigate } = deps;
  const root = el('div', 'project-creation');
  container.replaceChildren(root);

  let disposed = false;
  let busy = false;
  let actionError: string | null = null;
  let view: View = { name: 'loading', text: 'Loading your projects…' };
  let form: ProjectForm = newProjectForm([], null);
  let organisations: Organisation[] = [];
  let earlierProjects: Project[] = [];
  let myLogin: string | null = null;
  let inviteDraft = '';
  let inviteError: string | null = null;
  let domainDraft = '';

  function show(next: View): void {
    if (disposed) return;
    view = next;
    actionError = null;
    draw();
  }

  async function act(work: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    actionError = null;
    draw();
    try {
      await work();
    } catch (error) {
      actionError = messageOf(error);
    } finally {
      busy = false;
      if (!disposed) draw();
    }
  }

  const errorNote = (): HTMLElement[] => (actionError === null ? [] : [note(actionError, 'err')]);

  // ---------- Your projects and invitations ----------

  async function loadStart(): Promise<void> {
    show({ name: 'loading', text: 'Loading your projects…' });
    const [recents, projects, invitations] = await Promise.allSettled([
      store.listRecentProjects(),
      store.listProjects(),
      store.listPendingInvitations(),
    ]);
    const known = new Map(
      (projects.status === 'fulfilled' && Array.isArray(projects.value) ? projects.value.filter(isProject) : []).map(
        (project) => [project.id, project],
      ),
    );
    const recentList = listOrError(recents, isRecent);
    show({
      name: 'start',
      data: {
        recents: Array.isArray(recentList)
          ? recentList.map(({ project, lastOpened }) => ({
              id: project,
              name: known.get(project)?.name ?? project.slice(project.indexOf('/') + 1),
              archived: known.get(project)?.archived ?? false,
              lastOpened,
              damaged: known.get(project)?.damaged ?? null,
            }))
          : recentList,
        invitations: listOrError(invitations, isInvitation),
      },
    });
  }

  function openProject(project: ProjectId): Promise<void> {
    return act(async () => {
      await store.openProjectFolder(project);
      if (!disposed) navigate(MAP_SCREEN, { project });
    });
  }

  function accept(invitation: Invitation): Promise<void> {
    return act(async () => {
      await store.acceptInvitation(invitation.id);
      const last = await readLastMembership(grillo);
      show({
        name: 'invitee',
        joined: {
          invitation,
          project: idOf(invitation.repository),
          role: last?.role ?? '',
          domains: [...(last?.domains ?? [])],
          prefilledFrom: last?.project ?? null,
        },
      });
    });
  }

  function drawStart(data: StartData): HTMLElement[] {
    const projects = el('div', 'card stack', [
      el('div', 'row', [
        el('h3', 'm0', ['Your projects']),
        el('span', 'spacer'),
        button('New project', { variant: 'primary', disabled: busy, onClick: () => void openForm() }),
      ]),
      el('p', 'small muted m0', ['Recently opened first.']),
    ]);
    if (!Array.isArray(data.recents)) projects.append(note(data.recents.error, 'err'));
    else if (data.recents.length === 0) {
      projects.append(el('p', 'muted m0', ['No project opened on this laptop yet. Create one, or accept an invitation.']));
    } else {
      projects.append(
        el(
          'ul',
          'rows',
          data.recents.map((recent) =>
            el('li', '', [
              el('div', 'grow', [
                el('span', 'strong', [recent.name]),
                ...(recent.archived ? [' ', badge('Archived')] : []),
                ...(recent.damaged === null ? [] : [' ', badge('Damaged', 'warn')]),
                el('br', ''),
                el('span', 'small muted', [`${recent.id} · opened ${date(recent.lastOpened)}`]),
                ...(recent.damaged === null ? [] : [el('br', ''), el('span', 'reason', [`${asSentence(recent.damaged)} ${DAMAGED_PROJECT_HINT}`])]),
              ]),
              button('Open', { small: true, disabled: busy, onClick: () => void openProject(recent.id) }),
            ]),
          ),
        ),
      );
    }

    const pending = el('div', 'card stack', [el('h3', '', ['Pending invitations'])]);
    if (!Array.isArray(data.invitations)) pending.append(note(data.invitations.error, 'err'));
    else if (data.invitations.length === 0) pending.append(el('p', 'muted m0', ['No pending invitations.']));
    else {
      pending.append(
        el(
          'ul',
          'rows',
          data.invitations.map((invitation) =>
            el('li', '', [
              el('div', 'grow', [
                el('span', 'strong', [invitation.repository.name]),
                el('br', ''),
                el('span', 'small muted', [
                  `${idOf(invitation.repository)} · invited by ${invitation.inviter} on ${date(invitation.createdAt)}`,
                ]),
              ]),
              button('Accept', { variant: 'primary', small: true, disabled: busy, onClick: () => void accept(invitation) }),
            ]),
          ),
        ),
      );
    }
    pending.append(
      el('p', 'small muted m0', ['Accepting takes the GitHub repository invite in one click; you then set your role and domains.']),
    );
    return [...errorNote(), projects, pending];
  }

  // ---------- The new-project form ----------

  async function openForm(): Promise<void> {
    show({ name: 'loading', text: 'Loading your organisations…' });
    const [orgs, projects, last, identity] = await Promise.allSettled([
      store.listOrganisations(),
      store.listProjects(),
      readLastMembership(grillo),
      grillo.invoke('tools:identity', undefined),
    ]);
    organisations = orgs.status === 'fulfilled' && Array.isArray(orgs.value) ? orgs.value.filter(isOrganisation) : [];
    earlierProjects = [];
    if (projects.status === 'fulfilled' && Array.isArray(projects.value)) {
      for (const project of projects.value.filter(isProject).filter(({ damaged }) => damaged === undefined)) {
        try {
          earlierProjects.push({ ...project, structure: checkedStructure(project.structure, `the structure of ${project.id}`) });
        } catch {
          // A project whose structure cannot be read is simply not offered as a starting point.
        }
      }
    }
    const identityResult = identity.status === 'fulfilled' ? (identity.value as { ok?: unknown; identity?: { login?: unknown } }) : null;
    myLogin = identityResult?.ok === true && isText(identityResult.identity?.login) ? identityResult.identity.login : null;
    form = newProjectForm(
      organisations.map((organisation) => organisation.login),
      last.status === 'fulfilled' ? last.value : null,
    );
    inviteDraft = '';
    inviteError = null;
    domainDraft = '';
    show({ name: 'form' });
    if (orgs.status === 'rejected') actionError = `Grillo could not list your organisations: ${messageOf(orgs.reason)}`;
    draw();
  }

  function checkAccess(): Promise<void> {
    const repository = repositoryToConnect(form.connectTo);
    if (repository === null) {
      form.access = { state: 'unknown', message: 'Name the repository as owner/repository.' };
      draw();
      return Promise.resolve();
    }
    const id = idOf(repository);
    return act(async () => {
      form.access = { state: 'checking' };
      draw();
      try {
        const permission: unknown = await store.viewerPermission(id);
        form.access =
          permission === 'admin' || permission === 'write' || permission === 'read'
            ? { state: 'known', permission }
            : { state: 'unknown', message: 'Grillo could not read your access from the store.' };
      } catch (error) {
        form.access = { state: 'unknown', message: messageOf(error) };
      }
    });
  }

  /** True when the repository already holds a Grillo project: one project per repository (PRD section 4.2). */
  async function holdsProject(id: ProjectId): Promise<boolean> {
    try {
      checkedStructure(await store.getStructure(id), `the structure of ${id}`);
      return true;
    } catch {
      return false;
    }
  }

  function create(): Promise<void> {
    const problem = formProblem(form);
    if (problem !== null) {
      actionError = problem;
      draw();
      return Promise.resolve();
    }
    const draft = draftOf(form);
    return act(async () => {
      if ('connectRepository' in draft.repository) {
        const repository = idOf(draft.repository.connectRepository);
        if (await holdsProject(repository)) {
          show({ name: 'problem', problem: { repository, kind: 'grillo-project' } });
          return;
        }
      }
      await runCreation(startCreation({ store, grillo, now: deps.now }, draft), draft.repository);
    });
  }

  async function runCreation(creation: Creation, repository: ReturnType<typeof draftOf>['repository']): Promise<void> {
    show({ name: 'creating', creation });
    await creation.run(() => {
      if (!disposed && view.name === 'creating') draw();
    });
    const first = creation.steps[0];
    if (first.state === 'failed' && 'connectRepository' in repository) {
      show({
        name: 'problem',
        problem: { repository: idOf(repository.connectRepository), kind: 'refused', message: first.error ?? '' },
      });
    }
  }

  function repositoryCard(): HTMLElement {
    const card = el('div', 'card stack', [
      el('h3', '', ['1 · Repository']),
      segmented(
        'Repository',
        [
          { value: 'new', text: 'Create a new repository' },
          { value: 'connect', text: 'Connect an existing one' },
        ],
        form.mode,
        (mode) => {
          form.mode = mode;
          form.structureOpen = mode === 'new';
          draw();
        },
        busy,
      ),
    ]);
    if (form.mode === 'new') {
      const repositoryName = textInput({
        value: form.repositoryName,
        label: 'Repository name',
        disabled: busy,
        onInput: (value) => {
          form.repositoryName = value;
          form.repositoryNameTyped = true;
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
          }
        },
      });
      const organisation = el(
        'select',
        '',
        organisations.map((entry) => {
          const option = el('option', '', [entry.login]);
          option.value = entry.login;
          option.selected = entry.login === form.organisation;
          return option;
        }),
      );
      organisation.disabled = busy || organisations.length === 0;
      organisation.addEventListener('change', () => {
        form.organisation = organisation.value;
      });
      card.append(
        el('div', 'grid-2', [
          el('label', 'field', ['Project name', projectName]),
          el('label', 'field', ['Organisation', organisation]),
          el('label', 'field', ['Repository name', repositoryName]),
        ]),
        el('p', 'small muted m0', [
          'A private repository in the organisation you pick (the GitHub organisations your sign-in belongs to). Every member becomes a repository admin.',
        ]),
      );
      if (organisations.length === 0) {
        card.append(note('Your GitHub sign-in belongs to no organisation, so Grillo cannot create a repository. Connect an existing one instead.', 'warn'));
      }
      return card;
    }

    const repository = textInput({
      value: form.connectTo,
      type: 'search',
      label: 'Repository to connect',
      placeholder: 'owner/repository, for example example-org/sample-repo-1',
      disabled: busy,
      onInput: (value) => {
        form.connectTo = value;
        if (form.access.state !== 'unchecked') {
          form.access = { state: 'unchecked' };
          draw();
          const again = root.querySelector<HTMLInputElement>('input[aria-label="Repository to connect"]');
          again?.focus();
        }
      },
    });
    card.append(
      el('div', 'row', [el('div', 'fill', [repository]), button('Check access', { disabled: busy, onClick: () => void checkAccess() })]),
    );
    const access = accessRow();
    if (access) card.append(el('ul', 'rows', [access]));
    card.append(
      el('p', 'note small', [
        "Write access is enough. Grillo adds its labels, the map issue and its tickets, and one Grillo folder on the main branch. How saves reach main follows this repository's own rules. Existing issues are ignored.",
      ]),
    );
    return card;
  }

  function accessRow(): HTMLLIElement | null {
    const repository = repositoryToConnect(form.connectTo);
    const { access } = form;
    if (repository === null || access.state === 'unchecked') return null;
    const name = el('span', 'strong', [idOf(repository)]);
    switch (access.state) {
      case 'checking':
        return el('li', '', [name, badge('Checking…')]);
      case 'unknown':
        return el('li', '', [el('div', 'grow', [name, el('p', 'small muted m0', [access.message])]), badge('Access not known', 'warn')]);
      case 'known': {
        const badges = { admin: badge('Admin access', 'ok'), write: badge('Write access', 'warn'), read: badge('Read access only', 'err') };
        const row = el('li', access.permission === 'read' ? '' : 'selected', [name, badges[access.permission]]);
        if (access.permission === 'read') {
          row.append(el('p', 'small muted m0 full', ['Connecting needs write access. Ask one of its admins for it, or pick another repository.']));
        }
        return row;
      }
    }
  }

  function structureRows(structure: PrdStructure, update: (next: PrdStructure, redraw: boolean) => void): HTMLUListElement {
    const last = structure.sections.length - 1;
    return el(
      'ul',
      'rows structure',
      structure.sections.map((section, index) =>
        el('li', '', [
          el('span', 'row', [
            moveButton('↑', 'Move up', busy || index === 0, () => update(moveSection(structure, index, -1), true)),
            moveButton('↓', 'Move down', busy || index === last, () => update(moveSection(structure, index, 1), true)),
          ]),
          el('div', 'grow grid-2', [
            textInput({
              value: section.name,
              label: 'Section name',
              disabled: busy,
              onInput: (value) => {
                structure = renameSection(structure, index, value);
                update(structure, false);
              },
            }),
            textInput({
              value: section.note,
              label: 'Section note',
              disabled: busy,
              onInput: (value) => {
                structure = setSectionNote(structure, index, value);
                update(structure, false);
              },
            }),
          ]),
          button('Remove', { small: true, disabled: busy, onClick: () => update(removeSection(structure, index), true) }),
        ]),
      ),
    );
  }

  function moveButton(arrow: string, label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const move = button(arrow, { small: true, disabled, onClick });
    move.setAttribute('aria-label', label);
    return move;
  }

  function structureSourceName(): string {
    const earlier = earlierProjects.find((project) => project.id === form.structureFrom);
    return earlier ? earlier.name : 'Grillo default';
  }

  function structureCard(): HTMLElement {
    const card = el('div', 'card stack', [el('h3', '', ['2 · PRD structure'])]);
    if (!form.structureOpen) {
      const count = form.structure.sections.length;
      card.append(
        el('div', 'row', [
          el('span', '', [`${structureSourceName()} · ${count} ${count === 1 ? 'section' : 'sections'}`]),
          el('span', 'spacer'),
          button('Edit', {
            small: true,
            disabled: busy,
            onClick: () => {
              form.structureOpen = true;
              draw();
            },
          }),
        ]),
      );
      return card;
    }
    const from = el('select', '', [
      Object.assign(el('option', '', ['Grillo default']), { value: DEFAULT_STRUCTURE_CHOICE }),
      ...earlierProjects.map((project) =>
        Object.assign(el('option', '', [`${project.name} (an earlier project of yours)`]), { value: project.id }),
      ),
    ]);
    from.value = form.structureFrom;
    from.disabled = busy;
    from.addEventListener('change', () => {
      form.structureFrom = from.value;
      const earlier = earlierProjects.find((project) => project.id === from.value);
      form.structure = structuredClone(earlier ? earlier.structure : DEFAULT_PRD_STRUCTURE);
      draw();
    });
    card.append(
      field('Start from', from),
      el('p', 'small muted m0', ['With no choice made, the default applies. Edit it now or at any time later.']),
      structureRows(form.structure, (next, redraw) => {
        form.structure = next;
        if (redraw) draw();
      }),
      el('div', 'row', [
        button('Add section', {
          small: true,
          disabled: busy,
          onClick: () => {
            form.structure = addSection(form.structure);
            draw();
          },
        }),
      ]),
    );
    return card;
  }

  function domainsField(domains: string[], onChange: (next: string[]) => void): HTMLElement {
    const adding = textInput({
      value: domainDraft,
      label: 'Add a domain',
      placeholder: 'A domain, for example product',
      disabled: busy,
      onInput: (value) => {
        domainDraft = value;
      },
    });
    const add = () => {
      const typed = domainDraft;
      // Cleared before onChange redraws, so the redrawn field starts empty.
      domainDraft = '';
      onChange(cleanDomains([...domains, typed]));
    };
    adding.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') add();
    });
    return el('div', 'field', [
      'Your domains',
      el('span', 'row', [
        ...domains.map((domain) => tag(domain, busy ? undefined : () => onChange(domains.filter((entry) => entry !== domain)))),
        el('span', 'fill', [adding]),
        button('Add domain', { small: true, disabled: busy, onClick: add }),
      ]),
    ]);
  }

  function roleAndDomains(
    current: { role: string; domains: string[]; prefilledFrom: ProjectId | null },
    onRole: (role: string) => void,
    onDomains: (domains: string[]) => void,
  ): HTMLElement[] {
    const role = textInput({ value: current.role, disabled: busy, onInput: onRole });
    const parts: HTMLElement[] = [
      el('div', 'grid-2', [field('Your role (free text)', role), domainsField(current.domains, onDomains)]),
    ];
    if (current.prefilledFrom !== null) {
      parts.push(el('p', 'small muted m0', [`Pre-filled from the last project you joined, ${current.prefilledFrom}.`]));
    }
    return parts;
  }

  function addInvite(): void {
    inviteError = inviteProblem(inviteDraft, form.invites, myLogin);
    if (inviteError === null) {
      form.invites = [...form.invites, inviteDraft.trim()];
      inviteDraft = '';
    }
    draw();
    root.querySelector<HTMLInputElement>('input[aria-label="GitHub login to invite"]')?.focus();
  }

  function membersCard(): HTMLElement {
    const allowed = canInvite(form);
    const login = textInput({
      value: inviteDraft,
      label: 'GitHub login to invite',
      placeholder: allowed ? 'GitHub login, for example member-b' : 'GitHub login',
      disabled: busy || !allowed,
      onInput: (value) => {
        inviteDraft = value;
      },
    });
    login.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') addInvite();
    });
    const card = el('div', 'card stack', [
      el('h3', '', ['3 · Members']),
      el('div', 'row', [el('div', 'fill', [login]), button('Invite', { disabled: busy || !allowed, onClick: addInvite })]),
    ]);
    if (!allowed) {
      const repository = repositoryToConnect(form.connectTo);
      const where = repository ? idOf(repository) : 'the repository';
      const why =
        form.access.state === 'known'
          ? `you have ${form.access.permission} access`
          : 'Grillo has not confirmed your access yet (press Check access)';
      card.append(el('p', 'reason m0', [`Inviting needs admin rights on ${where}, and ${why}. Ask one of its admins to add people.`]));
    } else {
      card.append(el('p', 'small muted m0', ['An invite is a GitHub repository access invite.']));
    }
    if (inviteError !== null) card.append(note(inviteError, 'warn'));

    const me = el('li', '', [
      el('div', 'grow stack', [
        el('div', 'row', [el('span', 'strong', [myLogin ?? 'You']), badge('You', 'info')]),
        ...roleAndDomains(
          form,
          (role) => {
            form.role = role;
          },
          (domains) => {
            form.domains = domains;
            draw();
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
              form.invites = form.invites.filter((login) => login !== entry);
              draw();
            },
          }),
        ]),
      ]),
    );
    card.append(el('ul', 'rows', [me, ...invited]));
    return card;
  }

  function ideaCard(): HTMLElement {
    const text = form.ideaFormat === 'text';
    const area = el('textarea', '');
    area.setAttribute('aria-label', text ? 'The idea' : 'Transcript');
    area.placeholder = text
      ? 'The product idea in your own words: what it is for, who uses it, what goes wrong today.'
      : 'Paste the transcript of a recorded conversation, or upload its file.';
    area.value = text ? form.ideaText : form.transcript;
    area.disabled = busy;
    area.addEventListener('input', () => {
      if (text) form.ideaText = area.value;
      else form.transcript = area.value;
    });
    const files = text
      ? el('div', 'row', [
          ...filePicker('Attach documents', {
            accept: TEXT_FILES,
            multiple: true,
            disabled: busy,
            onFiles: (picked) =>
              void act(async () => {
                form.attachments = [...form.attachments, ...(await attachmentsFrom(picked))];
              }),
          }),
          ...form.attachments.map((attachment, index) =>
            tag(attachment.name, busy ? undefined : () => {
              form.attachments = form.attachments.filter((_entry, at) => at !== index);
              draw();
            }, 'none'),
          ),
        ])
      : el('div', 'row', [
          ...filePicker('Upload transcript file', {
            accept: TRANSCRIPT_FILES,
            multiple: false,
            disabled: busy,
            onFiles: (picked) =>
              void act(async () => {
                const [file] = await attachmentsFrom(picked);
                if (file) form.transcript = file.text;
              }),
          }),
        ]);
    return el('div', 'card stack', [
      el('h3', '', ['4 · The idea']),
      segmented(
        'Idea format',
        [
          { value: 'text', text: 'Write or paste text' },
          { value: 'transcript', text: 'Paste or upload a transcript' },
        ],
        form.ideaFormat,
        (format) => {
          form.ideaFormat = format;
          draw();
        },
        busy,
      ),
      area,
      files,
      el('p', 'small muted m0', [
        'The destination is always a PRD. Grillo then opens a grilling agent that builds the map, the tickets and their questions.',
      ]),
    ]);
  }

  function drawForm(): HTMLElement[] {
    return [
      repositoryCard(),
      structureCard(),
      membersCard(),
      ideaCard(),
      ...errorNote(),
      el('div', 'row', [
        el('span', 'spacer'),
        button('Cancel', { disabled: busy, onClick: () => void loadStart() }),
        button(form.mode === 'new' ? 'Create project' : 'Connect and start', {
          variant: 'primary',
          disabled: busy,
          onClick: () => void create(),
        }),
      ]),
    ];
  }

  // ---------- Connect: repository problems ----------

  function drawProblem(problem: ConnectProblem): HTMLElement[] {
    const back = (mode: ProjectForm['mode']) => {
      form.mode = mode;
      show({ name: 'form' });
      if (mode === 'connect') void checkAccess();
    };
    const row =
      problem.kind === 'grillo-project'
        ? el('li', '', [
            el('div', 'grow', [
              el('div', 'row', [el('span', 'strong', [problem.repository]), badge('Already holds a Grillo project', 'info')]),
              el('p', 'small muted m0', ['One Grillo project per repository. Open the one it holds instead.']),
            ]),
            button('Open it', { variant: 'primary', small: true, disabled: busy, onClick: () => void openProject(problem.repository) }),
          ])
        : el('li', '', [
            el('div', 'grow', [
              el('div', 'row', [el('span', 'strong', [problem.repository]), badge('Cannot connect', 'err')]),
              el('p', 'small muted m0', [problem.message]),
            ]),
            button('Check again', { small: true, disabled: busy, onClick: () => back('connect') }),
          ]);
    return [
      el('div', 'card stack', [
        el('h3', '', ['1 · Repository']),
        segmented(
          'Repository',
          [
            { value: 'new', text: 'Create a new repository' },
            { value: 'connect', text: 'Connect an existing one' },
          ],
          'connect',
          back,
          busy,
        ),
        el('ul', 'rows', [row]),
      ]),
      ...errorNote(),
    ];
  }

  // ---------- Creating ----------

  function drawCreating(creation: Creation): HTMLElement[] {
    const lastIndex = creation.steps.length - 1;
    const rows = creation.steps.map((step, index) => {
      const working = step.state === 'running' || (step.state === 'done' && index === lastIndex);
      const partly = step.state === 'done' && step.warning !== null;
      const dot = { waiting: '', running: 'warn', done: working || partly ? 'warn' : 'ok', failed: 'err' }[step.state];
      const status = working
        ? badge('Working…', 'warn')
        : partly
          ? badge('Partly done', 'warn')
          : step.state === 'done'
            ? badge('Done', 'ok')
            : step.state === 'failed'
              ? badge('Failed', 'err')
              : badge('Waiting');
      const row = el('li', '', [el('span', 'row', [el('span', `sdot ${dot}`.trim()), step.label]), status]);
      if (partly && step.warning !== null) row.append(el('p', 'small muted m0 full', [step.warning]));
      return row;
    });
    const failed = creation.steps.find((step) => step.state === 'failed');
    const parts: HTMLElement[] = [el('ul', 'rows card', rows)];
    if (failed) {
      parts.push(note(failed.error ?? 'This step failed.', 'err'));
      const actions: HTMLElement[] = [el('span', 'spacer')];
      if (creation.project() === null) actions.push(button('Back to the form', { disabled: busy, onClick: () => show({ name: 'form' }) }));
      actions.push(
        button('Try again', {
          variant: 'primary',
          disabled: busy,
          onClick: () =>
            void act(async () => {
              await creation.run(() => draw());
            }),
        }),
      );
      parts.push(el('div', 'row', actions));
    }
    const project = creation.project();
    const agentId = creation.agent();
    if (project !== null && agentId !== null) {
      parts.push(
        el('p', 'note small', ['Tickets appear on the map as the engine creates them, and you can edit them at once.']),
        el('div', 'row', [
          el('span', 'spacer'),
          button('Open the map', { onClick: () => navigate(MAP_SCREEN, { project }) }),
          button('Open the grilling agent', { variant: 'primary', onClick: () => navigate(AGENT_SCREEN, { agentId }) }),
        ]),
      );
    }
    return parts;
  }

  // ---------- After accepting an invite ----------

  function drawInvitee(joined: Joined): HTMLElement[] {
    const save = () =>
      act(async () => {
        const member: unknown = await store.currentMember(joined.project);
        const login = (member as { login?: unknown } | null)?.login;
        if (!isText(login) || login === '') throw new Error('Grillo could not read who you are in this project.');
        const membership = { role: joined.role.trim(), domains: cleanDomains(joined.domains) };
        await store.updateMember(joined.project, login, membership);
        const last: LastMembership = { project: joined.project, ...membership };
        await saveLastMembership(grillo, last);
        await store.openProjectFolder(joined.project);
        if (!disposed) navigate(MAP_SCREEN, { project: joined.project });
      });
    return [
      el('div', 'card stack', [
        el('div', 'row', [el('h3', 'm0', [`You joined ${joined.invitation.repository.name}`]), badge('Invite accepted', 'ok')]),
        el('p', 'small muted m0', [`Invited by ${joined.invitation.inviter} · repository ${joined.project}.`]),
        ...roleAndDomains(
          joined,
          (role) => {
            joined.role = role;
          },
          (domains) => {
            joined.domains = domains;
            draw();
          },
        ),
        ...errorNote(),
        el('div', 'row', [
          el('span', 'spacer'),
          button('Save and open the project', { variant: 'primary', disabled: busy, onClick: () => void save() }),
        ]),
      ]),
    ];
  }

  // ---------- Editing the structure of an existing project ----------

  async function loadStructure(project: ProjectId): Promise<void> {
    show({ name: 'loading', text: 'Loading the PRD structure…' });
    try {
      show({ name: 'structure', project, structure: checkedStructure(await store.getStructure(project), `the structure of ${project}`) });
    } catch (error) {
      show({ name: 'failed', message: messageOf(error) });
    }
  }

  function drawStructure(current: Extract<View, { name: 'structure' }>): HTMLElement[] {
    const saveAndRegenerate = () => {
      const problem = structureProblem(current.structure);
      if (problem !== null) {
        actionError = problem;
        draw();
        return;
      }
      void act(async () => {
        const structure = {
          sections: current.structure.sections.map(({ name, note: line }) => ({ name: name.trim(), note: line.trim() })),
        };
        await store.updateStructure(current.project, structure);
        const folder = await store.openProjectFolder(current.project);
        await grillo.invoke('agents:start', {
          kind: 'grilling',
          folder,
          firstMessage: REGENERATE_COMMAND,
          title: agentTitle('grilling', 'PRD'),
        });
        if (!disposed) navigate(PRD_SCREEN, { project: current.project });
      });
    };
    return [
      el('div', 'card stack', [
        el('h3', '', ['PRD structure']),
        el('p', 'small muted m0', [
          'Any member can change the structure at any time. A new section makes the engine add tickets or fog first, so the PRD is regenerated once every section can be written.',
        ]),
        structureRows(current.structure, (next, redraw) => {
          current.structure = next;
          if (redraw) draw();
        }),
        ...errorNote(),
        el('div', 'row', [
          button('Add section', {
            small: true,
            disabled: busy,
            onClick: () => {
              current.structure = addSection(current.structure);
              draw();
            },
          }),
          el('span', 'spacer'),
          button('Cancel', { disabled: busy, onClick: () => navigate(PRD_SCREEN, { project: current.project }) }),
          button('Save and regenerate', { variant: 'primary', disabled: busy, onClick: saveAndRegenerate }),
        ]),
      ]),
    ];
  }

  function draw(): void {
    const parts: Content[] = (() => {
      switch (view.name) {
        case 'loading':
          return [el('p', 'muted', [view.text])];
        case 'failed':
          return [note(view.message, 'err')];
        case 'start':
          return drawStart(view.data);
        case 'form':
          return drawForm();
        case 'problem':
          return drawProblem(view.problem);
        case 'invitee':
          return drawInvitee(view.joined);
        case 'creating':
          return drawCreating(view.creation);
        case 'structure':
          return drawStructure(view);
      }
    })();
    root.replaceChildren(...parts);
  }

  const project = params['project'];
  if (typeof project === 'string' && project !== '') {
    if (PROJECT_ID.test(project)) void loadStructure(project);
    else show({ name: 'failed', message: `'${project}' is not a project: expected owner/repository.` });
  } else {
    void loadStart();
  }

  return () => {
    disposed = true;
  };
}
