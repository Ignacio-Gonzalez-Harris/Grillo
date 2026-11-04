/**
 * Project creation and invites, with the PRD structure (PRD sections 4.2 and 7, section 5 screen 2; prototype
 * `screen-project-creation`). Opened with no params it shows the member's recent projects and pending invitations, and
 * from there the two ways in: four guided steps (Where, Structure, People, Idea) and a review. Opened with
 * `{ project: '<owner>/<repo>' }` (from the PRD view) it shows that project's structure editor.
 */
import './project-creation.css';
import type { Store } from '../../../main/store/store';
import type {
  Invitation,
  Organisation,
  PrdStructure,
  Project,
  ProjectId,
  RecentProject,
  RepositoryAccess,
} from '../../../main/store/types';
import { agentTitle } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import { AGENT_SCREEN } from '../../app/navigation';
import type { ScreenParams } from '../../app/screens';
import { badge, button } from '../../theme/components';
import { REGENERATE_COMMAND, resumeCreation, startCreation, type Creation } from './create';
import { creatingPage } from './creating-page';
import {
  FORM_STEPS,
  NO_REPOSITORY_PICKED,
  draftOf,
  firstStepWithProblem,
  newProjectForm,
  repositoryToConnect,
  stepProblem,
  type FormStep,
  type ProjectForm,
  type RepositoryMode,
} from './form';
import { cleanDomains, readLastMembership, saveLastMembership, type LastMembership } from './membership';
import { reviewHead, reviewList } from './review-page';
import { startPage, type RecentRow, type StartData } from './start-page';
import { ideaCard, ideaHead } from './step-idea';
import { peopleCard, peopleHead, roleAndDomains } from './step-people';
import { structureCard, structureHead, structureRows } from './step-structure';
import { modeSwitch, whereCard, whereHead } from './step-where';
import { addSection, checkedStructure, structureProblem } from './structure';
import { forgetUnstartedAgent, readUnstartedAgents, type UnstartedAgent } from './unstarted';
import { dropReason, el, messageOf, note, pageActions, pageHead, plainReason, stepProgress, type Content } from './view';
import type { Drafts, WizardContext } from './wizard';

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

type ConnectProblem = { repository: ProjectId } & ({ kind: 'grillo-project' } | { kind: 'refused'; message: string });

interface Joined {
  invitation: Invitation;
  project: ProjectId;
  role: string;
  domains: string[];
  prefilledFrom: ProjectId | null;
}

/** The page of the guided steps on screen: one of the four steps, or the review. */
type FormPage = FormStep | 'review';

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

function isRepositoryAccess(value: unknown): value is RepositoryAccess {
  const entry = value as Partial<Record<keyof RepositoryAccess, unknown>> | null;
  const repository = entry?.repository as { owner?: unknown; name?: unknown } | null | undefined;
  return (
    isText(repository?.owner) &&
    isText(repository.name) &&
    (entry?.permission === 'admin' || entry?.permission === 'write' || entry?.permission === 'read')
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
  /** Why the page stopped the member, shown beside the control that caused it. */
  let stepReason: string | null = null;
  let view: View = { name: 'loading', text: 'Loading your projects…' };
  let form: ProjectForm = newProjectForm([], null);
  let formPage: FormPage = 'where';
  /** Once the review has been seen, every step offers a way straight back to it. */
  let reviewSeen = false;
  let organisations: Organisation[] = [];
  /** Why the Owner list may be short. It lasts until the form is opened again, so Where says it each time it is drawn. */
  let ownersProblem: string | null = null;
  let repositories: RepositoryAccess[] | { error: string } = [];
  let earlierProjects: Project[] = [];
  let myLogin: string | null = null;
  const drafts: Drafts = { invite: '', inviteError: null, domain: '' };

  function show(next: View): void {
    if (disposed) return;
    view = next;
    actionError = null;
    stepReason = null;
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

  function clearReason(): void {
    stepReason = null;
    dropReason(root);
  }

  /** Brings the new page to the top and to the keyboard: the page before may have been scrolled a long way down. */
  function revealPage(): void {
    const heading = root.querySelector<HTMLElement>('.page-head h3');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
    // The whole window scrolls on a long screen (shell.css), so the top of the document brings the tab bar back too.
    document.scrollingElement?.scrollTo?.(0, 0);
  }

  function revealReason(): void {
    root.querySelector('[data-reason]')?.scrollIntoView?.({ block: 'center' });
  }

  // ---------- Your projects and invitations ----------

  async function loadStart(): Promise<void> {
    show({ name: 'loading', text: 'Loading your projects…' });
    const [recents, projects, invitations, unstartedAgents] = await Promise.allSettled([
      store.listRecentProjects(),
      store.listProjects(),
      store.listPendingInvitations(),
      readUnstartedAgents(grillo),
    ]);
    const known = new Map(
      (projects.status === 'fulfilled' && Array.isArray(projects.value) ? projects.value.filter(isProject) : []).map(
        (project) => [project.id, project],
      ),
    );
    const recentList = listOrError(recents, isRecent);
    const rowOf = (project: ProjectId, when: string): RecentRow => ({
      id: project,
      name: known.get(project)?.name ?? project.slice(project.indexOf('/') + 1),
      archived: known.get(project)?.archived ?? false,
      when,
      damaged: known.get(project)?.damaged ?? null,
    });
    // A refused start can come before the project was ever opened: it still needs a row to start again from.
    const neverOpened = (list: readonly RecentProject[]): RecentRow[] =>
      (unstartedAgents.status === 'fulfilled' ? unstartedAgents.value : [])
        .filter(({ project }) => PROJECT_ID.test(project) && !list.some((recent) => recent.project === project))
        .map(({ project, at }) => rowOf(project, `created ${date(at)}`));
    show({
      name: 'start',
      data: {
        recents: Array.isArray(recentList)
          ? [...neverOpened(recentList), ...recentList.map(({ project, lastOpened }) => rowOf(project, `opened ${date(lastOpened)}`))]
          : recentList,
        invitations: listOrError(invitations, isInvitation),
      },
    });
  }

  /** The refused start to try again for this project; none once the project has a map, however it came by one. */
  async function unstartedAgentOf(project: ProjectId): Promise<UnstartedAgent | null> {
    const unstarted = (await readUnstartedAgents(grillo)).find((entry) => entry.project === project);
    if (!unstarted) return null;
    const hasMap = await store.getMap(project).then(
      () => true,
      () => false,
    );
    if (!hasMap) return unstarted;
    await forgetUnstartedAgent(grillo, project);
    return null;
  }

  function openProject(project: ProjectId): Promise<void> {
    return act(async () => {
      const unstarted = await unstartedAgentOf(project);
      if (unstarted) {
        show({ name: 'creating', creation: resumeCreation({ store, grillo, now: deps.now }, unstarted) });
        return;
      }
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

  // ---------- The guided steps ----------

  async function openForm(mode: RepositoryMode): Promise<void> {
    show({ name: 'loading', text: 'Loading your organisations…' });
    const [orgs, own, repositoryList, projects, last, identity] = await Promise.allSettled([
      store.listOrganisations(),
      store.signedInLogin(),
      store.listRepositories(),
      store.listProjects(),
      readLastMembership(grillo),
      grillo.invoke('tools:identity', undefined),
    ]);
    organisations = orgs.status === 'fulfilled' && Array.isArray(orgs.value) ? orgs.value.filter(isOrganisation) : [];
    repositories = listOrError(repositoryList, isRepositoryAccess);
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
      own.status === 'fulfilled' && isText(own.value) && own.value !== '' ? own.value : null,
    );
    form.mode = mode;
    form.structureOpen = mode === 'new';
    formPage = 'where';
    reviewSeen = false;
    drafts.invite = '';
    drafts.inviteError = null;
    drafts.domain = '';
    ownersProblem = null;
    if (orgs.status === 'rejected') ownersProblem = `Grillo could not list your organisations: ${messageOf(orgs.reason)}`;
    else if (own.status === 'rejected') ownersProblem = `Grillo could not read your GitHub account: ${messageOf(own.reason)}`;
    show({ name: 'form' });
    if (!disposed) revealPage();
  }

  function goTo(page: FormPage): void {
    formPage = page;
    if (page === 'review') reviewSeen = true;
    show({ name: 'form' });
    if (!disposed) revealPage();
  }

  /** Puts the member on this step with the reason beside the control that caused it. */
  function stopAt(step: FormStep, reason: string): void {
    formPage = step;
    if (step === 'structure') form.structureOpen = true;
    show({ name: 'form' });
    stepReason = reason;
    draw();
    revealReason();
  }

  /** The review, unless some step has a problem by now: then that step, saying why. */
  function toReview(): void {
    // A repository typed in full and never checked: the review must still warn when it is public.
    if (form.mode === 'connect' && form.access.state === 'unchecked') void checkAccess();
    const step = firstStepWithProblem(form);
    if (step === null) goTo('review');
    else stopAt(step, stepProblem(form, step) as string);
  }

  /** Next is stopped by this step's own problem and by nothing else. */
  function next(step: FormStep): void {
    const problem = stepProblem(form, step);
    if (problem !== null) {
      stopAt(step, problem);
      return;
    }
    const following = FORM_STEPS[FORM_STEPS.indexOf(step) + 1];
    if (following === undefined) toReview();
    else goTo(following);
  }

  function checkAccess(): Promise<void> {
    const repository = repositoryToConnect(form.connectTo);
    if (repository === null) {
      stepReason = NO_REPOSITORY_PICKED;
      draw();
      return Promise.resolve();
    }
    const id = idOf(repository);
    return act(async () => {
      form.access = { state: 'checking' };
      draw();
      try {
        const permission: unknown = await store.viewerPermission(id);
        const isPublic = await store.isPublicRepository(id).then(
          (answer: unknown) => (typeof answer === 'boolean' ? answer : null),
          () => null,
        );
        form.access =
          permission === 'admin' || permission === 'write' || permission === 'read'
            ? { state: 'known', permission, isPublic }
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
    const step = firstStepWithProblem(form);
    if (step !== null) {
      stopAt(step, stepProblem(form, step) as string);
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

  function wizard(): WizardContext {
    return {
      root,
      form,
      busy,
      reason: stepReason,
      organisations,
      repositories,
      earlierProjects,
      myLogin,
      drafts,
      redraw: draw,
      act,
      clearReason,
      clearMessages: () => {
        stepReason = null;
        actionError = null;
      },
      checkAccess,
    };
  }

  function drawStep(step: FormStep): HTMLElement[] {
    const ctx = wizard();
    const pages: Record<FormStep, () => [HTMLElement, HTMLElement]> = {
      where: () => [whereHead(form.mode), whereCard(ctx)],
      structure: () => [structureHead(), structureCard(ctx)],
      people: () => [peopleHead(), peopleCard(ctx)],
      idea: () => [ideaHead(), ideaCard(ctx)],
    };
    const [head, card] = pages[step]();
    const at = FORM_STEPS.indexOf(step);
    return [
      stepProgress(step),
      head,
      ...(step === 'where' && ownersProblem !== null ? [note(ownersProblem, 'err')] : []),
      ...errorNote(),
      card,
      pageActions(
        [
          button('Cancel', { disabled: busy, onClick: () => void loadStart() }),
          ...(reviewSeen ? [button('Back to review', { disabled: busy, onClick: toReview })] : []),
          button('Next', { variant: 'primary', disabled: busy, onClick: () => next(step) }),
        ],
        at === 0 ? [] : [button('Back', { disabled: busy, onClick: () => goTo(FORM_STEPS[at - 1]) })],
      ),
    ];
  }

  function drawReview(): HTMLElement[] {
    const action = form.mode === 'new' ? 'Create project' : 'Connect and start';
    return [
      stepProgress('review'),
      reviewHead(action),
      ...errorNote(),
      reviewList(wizard(), goTo),
      pageActions(
        [
          button('Cancel', { disabled: busy, onClick: () => void loadStart() }),
          button(action, { variant: 'primary', disabled: busy, onClick: () => void create() }),
        ],
        [button('Back', { disabled: busy, onClick: () => goTo('idea') })],
      ),
    ];
  }

  // ---------- Connect: repository problems ----------

  function drawProblem(problem: ConnectProblem): HTMLElement[] {
    const back = (mode: ProjectForm['mode']) => {
      form.mode = mode;
      formPage = 'where';
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
              el('p', 'small muted m0', [plainReason(problem.message)]),
            ]),
            button('Check again', { small: true, disabled: busy, onClick: () => back('connect') }),
          ]);
    return [
      stepProgress('where'),
      pageHead("This repository can't be used as it is", 'Your other answers are safe. Sort this out, or pick another repository.'),
      el('div', 'card stack', [modeSwitch('connect', busy, back), el('ul', 'rows', [row])]),
      ...errorNote(),
      pageActions([
        button('Cancel', { disabled: busy, onClick: () => void loadStart() }),
        button('Pick another repository', {
          disabled: busy,
          onClick: () => {
            form.mode = 'connect';
            goTo('where');
          },
        }),
      ]),
    ];
  }

  // ---------- Creating ----------

  function drawCreating(creation: Creation): HTMLElement[] {
    return creatingPage(creation, {
      busy,
      backToWhere: () => goTo('where'),
      openMap: (project) => navigate(MAP_SCREEN, { project }),
      openAgent: (agentId) => navigate(AGENT_SCREEN, { agentId }),
      tryAgain: () =>
        void act(async () => {
          await creation.run(() => draw());
        }),
    });
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
      pageHead(
        `You joined ${joined.invitation.repository.name}`,
        `Invited by ${joined.invitation.inviter} · repository ${joined.project}. Tell Grillo your role and domains (the subjects you know about), so the right questions reach you.`,
        badge('Invite accepted', 'ok'),
      ),
      el('div', 'card stack', [
        ...roleAndDomains(
          busy,
          drafts,
          joined,
          (role) => {
            joined.role = role;
          },
          (domains) => {
            joined.domains = domains;
            draw();
          },
        ),
      ]),
      ...errorNote(),
      pageActions([button('Save and open the project', { variant: 'primary', disabled: busy, onClick: () => void save() })]),
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
        stepReason = problem;
        draw();
        revealReason();
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
      pageHead(
        'Change the PRD structure',
        'Any member can change the structure at any time. A new section may need more answers first: Grillo adds tickets (pieces of work and their questions) or notes what is still unclear, and writes the PRD again once every section can be written.',
      ),
      el('div', 'card stack', [
        ...structureRows(current.structure, {
          busy,
          reason: stepReason,
          update: (next, redraw) => {
            current.structure = next;
            clearReason();
            if (redraw) draw();
          },
        }),
        el('div', 'row', [
          button('Add section', {
            small: true,
            disabled: busy,
            onClick: () => {
              current.structure = addSection(current.structure);
              clearReason();
              draw();
            },
          }),
        ]),
      ]),
      ...errorNote(),
      pageActions([
        button('Cancel', { disabled: busy, onClick: () => navigate(PRD_SCREEN, { project: current.project }) }),
        button('Save and regenerate', { variant: 'primary', disabled: busy, onClick: saveAndRegenerate }),
      ]),
    ];
  }

  function draw(): void {
    const parts: Content[] = (() => {
      switch (view.name) {
        case 'loading':
          return [el('p', 'muted', [view.text])];
        case 'failed':
          return [pageHead("This structure can't be opened", 'Grillo could not read it. Try again from the PRD view.'), note(view.message, 'err')];
        case 'start':
          return [
            ...errorNote(),
            ...startPage(view.data, {
              busy,
              onNewProject: () => void openForm('new'),
              onConnectExisting: () => void openForm('connect'),
              onOpen: (project) => void openProject(project),
              onAccept: (invitation) => void accept(invitation),
            }),
          ];
        case 'form':
          return formPage === 'review' ? drawReview() : drawStep(formPage);
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
