/**
 * What the pages of the guided steps share: the state they read and the few actions they call back. Each page builds
 * its elements from a fresh copy of this on every redraw; `form` and `drafts` are the live objects they edit.
 */
import type { Login, Organisation, Project, RepositoryAccess } from '../../../main/store/types';
import type { ProjectForm } from './form';

/** What is typed but not added yet; it survives Back and Next, and is never part of the project unless added. */
export interface Drafts {
  invite: string;
  inviteError: string | null;
  domain: string;
}

export interface WizardContext {
  root: HTMLElement;
  form: ProjectForm;
  busy: boolean;
  /** Why this step stopped the member, shown beside the control that caused it; null when it has not. */
  reason: string | null;
  organisations: Organisation[];
  repositories: RepositoryAccess[] | { error: string };
  earlierProjects: Project[];
  myLogin: Login | null;
  drafts: Drafts;
  redraw(): void;
  act(work: () => Promise<void>): Promise<void>;
  /** Forgets the reason and takes it off the page, with no redraw: the member is typing. */
  clearReason(): void;
  /** Forgets the reason and any other note on the page; the next redraw shows neither. */
  clearMessages(): void;
  checkAccess(): Promise<void>;
}
