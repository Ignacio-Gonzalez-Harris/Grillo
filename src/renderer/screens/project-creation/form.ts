/**
 * The new-project form behind the guided steps (prototype `screen-project-creation`, Where to Idea): what the member
 * has filled in, what each step still needs, and the draft the creation steps run from.
 */
import { DEFAULT_PRD_STRUCTURE } from '../../../main/store/defaults';
import type { Login, Permission, PrdStructure, ProjectId, RepositoryAccess, RepositoryRef, RepositoryVisibility } from '../../../main/store/types';
import type { Attachment, ProjectDraft, RepositoryChoice } from './create';
import { cleanDomains, type LastMembership } from './membership';
import { structureProblem } from './structure';

export type RepositoryMode = 'new' | 'connect';
export type IdeaFormat = 'text' | 'transcript';

/** The four guided steps, the same for both ways in; only Where differs. */
export type FormStep = 'where' | 'structure' | 'people' | 'idea';
export const FORM_STEPS: readonly FormStep[] = ['where', 'structure', 'people', 'idea'];
export const STEP_NAMES: Record<FormStep, string> = { where: 'Where', structure: 'Structure', people: 'People', idea: 'Idea' };

/** What Grillo knows of the member's access to the repository to connect. */
export type Access =
  | { state: 'unchecked' }
  | { state: 'checking' }
  | { state: 'known'; permission: Permission }
  | { state: 'unknown'; message: string };

/** The value of "Start from" that means Grillo's shipped default. */
export const DEFAULT_STRUCTURE_CHOICE = 'default';

export interface ProjectForm {
  mode: RepositoryMode;
  projectName: string;
  /** The new repository's owner: one of the member's organisations, or their own account. */
  organisation: Login;
  /** The signed-in account, or null when it could not be read. */
  ownAccount: Login | null;
  /** Chosen for the own account only; an organisation's repository is always private. */
  visibility: RepositoryVisibility;
  repositoryName: string;
  /** True once the member typed a repository name: the project name stops suggesting one. */
  repositoryNameTyped: boolean;
  /** What the member typed in the repository search. */
  connectSearch: string;
  /** `<owner>/<repo>` to connect: picked from the list, or typed in full in the search. */
  connectTo: string;
  access: Access;
  /** `default`, or the id of the earlier project whose structure the member started from. */
  structureFrom: string;
  structure: PrdStructure;
  /** The connect state shows the structure folded until the member presses Edit. */
  structureOpen: boolean;
  invites: Login[];
  role: string;
  domains: string[];
  /** The project the role and domains were pre-filled from; null when nothing was pre-filled. */
  prefilledFrom: ProjectId | null;
  ideaFormat: IdeaFormat;
  ideaText: string;
  transcript: string;
  attachments: Attachment[];
}

export function newProjectForm(organisations: readonly Login[], last: LastMembership | null, ownAccount: Login | null = null): ProjectForm {
  return {
    mode: 'new',
    projectName: '',
    organisation: organisations[0] ?? ownAccount ?? '',
    ownAccount,
    visibility: 'private',
    repositoryName: '',
    repositoryNameTyped: false,
    connectSearch: '',
    connectTo: '',
    access: { state: 'unchecked' },
    structureFrom: DEFAULT_STRUCTURE_CHOICE,
    structure: structuredClone(DEFAULT_PRD_STRUCTURE),
    structureOpen: true,
    invites: [],
    role: last?.role ?? '',
    domains: [...(last?.domains ?? [])],
    prefilledFrom: last?.project ?? null,
    ideaFormat: 'text',
    ideaText: '',
    transcript: '',
    attachments: [],
  };
}

export const NO_REPOSITORY_PICKED = 'Pick the repository to connect from the list, or type it in full as owner/repository.';
const REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/;
const REPOSITORY_ID = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;
/** GitHub's rule for a login: letters, digits and single hyphens, not at either end, at most 39 characters. */
const GITHUB_LOGIN = /^(?=.{1,39}$)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** A repository name suggested from the project name: `Sample project 1` becomes `sample-project-1`. */
export function suggestedRepositoryName(projectName: string): string {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The repository to connect, from what the member typed (`owner/repo`, spaces around it ignored); null if malformed. */
export function repositoryToConnect(typed: string): RepositoryRef | null {
  const match = REPOSITORY_ID.exec(typed.trim());
  return match ? { owner: match[1], name: match[2] } : null;
}

/** The repositories whose `owner/name` holds what was searched, whatever the case; all of them for an empty search. */
export function matchingRepositories(repositories: readonly RepositoryAccess[], search: string): RepositoryAccess[] {
  const wanted = search.trim().toLowerCase();
  return repositories.filter(({ repository }) => `${repository.owner}/${repository.name}`.toLowerCase().includes(wanted));
}

/** Why this login cannot go on the invite list, or null when it can. */
export function inviteProblem(login: string, invites: readonly Login[], me: Login | null): string | null {
  const typed = login.trim();
  if (!GITHUB_LOGIN.test(typed)) return `"${typed}" is not a GitHub login: letters, digits and single hyphens only.`;
  if (me !== null && typed.toLowerCase() === me.toLowerCase()) return 'That is you: you are a member already.';
  if (invites.some((entry) => entry.toLowerCase() === typed.toLowerCase())) return `${typed} is on the list already.`;
  return null;
}

/** True when the new repository goes under the member's own account: only then is there a private or public choice. */
export function ownedByMember(form: ProjectForm): boolean {
  return form.organisation === form.ownAccount;
}

/** Inviting is for repository admins (PRD section 7): in a connected repository, only once admin access is known. */
export function canInvite(form: ProjectForm): boolean {
  return form.mode === 'new' || (form.access.state === 'known' && form.access.permission === 'admin');
}

export function ideaOf(form: ProjectForm): string {
  return form.ideaFormat === 'text' ? form.ideaText : form.transcript;
}

function whereProblem(form: ProjectForm): string | null {
  if (form.mode === 'connect') return repositoryToConnect(form.connectTo) === null ? NO_REPOSITORY_PICKED : null;
  if (form.organisation === '') return 'Pick the owner of the new repository.';
  if (!REPOSITORY_NAME.test(form.repositoryName.trim())) {
    return 'Give the repository a name: letters, digits, ".", "-" and "_" only.';
  }
  return null;
}

/** What stops the member from leaving this step with Next, said for the member; null when nothing does. */
export function stepProblem(form: ProjectForm, step: FormStep): string | null {
  switch (step) {
    case 'where':
      return whereProblem(form);
    case 'structure':
      return structureProblem(form.structure);
    case 'people':
      return null;
    case 'idea':
      return ideaOf(form).trim() === '' ? 'Give the idea: write it, or paste or upload a transcript.' : null;
  }
}

/** The earliest step that still has a problem; null when the project can be created. */
export function firstStepWithProblem(form: ProjectForm): FormStep | null {
  return FORM_STEPS.find((step) => stepProblem(form, step) !== null) ?? null;
}

/** What the creation steps run from; call only once `firstStepWithProblem` is null. */
export function draftOf(form: ProjectForm): ProjectDraft {
  const repository: RepositoryChoice =
    form.mode === 'new'
      ? {
          newRepository: {
            organisation: form.organisation,
            name: form.repositoryName.trim(),
            ...(ownedByMember(form) ? { visibility: form.visibility } : {}),
          },
        }
      : { connectRepository: repositoryToConnect(form.connectTo) as RepositoryRef };
  const text = form.ideaFormat === 'text';
  return {
    repository,
    projectName: form.mode === 'new' ? form.projectName.trim() : '',
    structure: { sections: form.structure.sections.map(({ name, note }) => ({ name: name.trim(), note: note.trim() })) },
    invites: canInvite(form) ? [...form.invites] : [],
    membership: { role: form.role.trim(), domains: cleanDomains(form.domains) },
    idea: { kind: text ? 'pasted-text' : 'meeting', text: ideaOf(form) },
    attachments: text ? [...form.attachments] : [],
  };
}

/** Each picked file as text, with its name. */
export async function attachmentsFrom(files: readonly File[]): Promise<Attachment[]> {
  return Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })));
}
