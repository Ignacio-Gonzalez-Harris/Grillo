import type {
  Answer,
  Decision,
  Discussion,
  GrillingSession,
  Invitation,
  IsoDateTime,
  Login,
  Member,
  Organisation,
  Permission,
  PickupComment,
  PrdStructure,
  PrdVersion,
  Project,
  ProjectId,
  ProjectMap,
  QuestionCode,
  RecentProject,
  RepositoryRef,
  Score,
  Source,
  SourceCode,
  SourceKind,
  Ticket,
  TicketId,
  TicketKind,
  Via,
} from './types';

// The error type and the method list are shared with the renderer, which gets the same refusals.
export { STORE_METHODS, StoreError, type StoreErrorKind, type StoreMethod } from '../../shared/store';

/** Two ways in (PRD section 4.2 item 1). The structure defaults to the 13 shipped sections. */
export type CreateProjectInput = (
  | { newRepository: { organisation: Login; name: string } }
  | { connectRepository: RepositoryRef }
) & { structure?: PrdStructure };

export interface NewMember {
  login: Login;
  role: string;
  domains: string[];
}

export type MemberPatch = Partial<Pick<Member, 'role' | 'domains'>>;

export type NewMap = Pick<ProjectMap, 'destination' | 'notes' | 'fog' | 'outOfScope'>;

export type MapPatch = Partial<NewMap>;

export interface NewTicket {
  title: string;
  question: string;
  whyItMatters: string;
  assumptions: string[];
  kind: TicketKind;
  blockers: number[];
  /** The questions' texts, in order; each gets the code `Q<issue number>.<k>`. */
  questions: string[];
}

export type TicketPatch = Partial<
  Pick<Ticket, 'title' | 'question' | 'whyItMatters' | 'assumptions' | 'kind' | 'domains' | 'noDomain' | 'blockers'>
>;

/** Filters for `listTickets`; the signed-in member's own tickets come first and pass every domain filter. */
export interface TicketFilter {
  state?: Ticket['state'];
  /** Keep tickets tagged with any of these domains, plus every "no domain" ticket. */
  domains?: string[];
}

/** What every new comment record carries; `who` and `when` are the signed-in member and now. */
export interface CommentInput {
  sources: SourceCode[];
  via: Via | null;
}

export interface NewAnswer extends CommentInput {
  question: QuestionCode;
  text: string;
  /** The plain member comment this answer was turned from (PRD section 4.4 item 5); null when typed. */
  fromComment: string | null;
}

export interface NewDiscussion extends CommentInput {
  question: QuestionCode;
  transcript: string;
  sessionFile: string | null;
}

export interface NewDecision extends CommentInput {
  text: string;
  gist: string;
}

export interface NewSession {
  present: Login[];
}

export type SessionPatch = Partial<Pick<GrillingSession, 'present' | 'transcript'>> & {
  /** True records the signed-in member as the host who ticked consent, now. */
  consent?: true;
};

export interface NewSource {
  kind: SourceKind;
  who: string;
  when: IsoDateTime;
  where: string;
  text: string;
}

export interface NewPrdVersion {
  body: string;
  appendix: string;
}

/** What closing or merging a ticket leaves behind: the map is done when no ticket is open and no fog is left. */
export interface CloseResult {
  mapDone: boolean;
}

/**
 * The one store interface (PRD section 6.3). Every screen reads and writes Grillo's data through it, so a
 * second backend can replace GitHub behind it. Every method is async and refuses with `StoreError` only.
 *
 * A record that does not exist is refused with `not-found`; a write to an archived project with
 * `read-only`. Records that are never deleted say why at their methods.
 */
export interface Store {
  // The signed-in member and their GitHub surroundings.
  /** The GitHub identity (login, name, email) plus role and domains from the project's members file. */
  currentMember(project: ProjectId): Promise<Member>;
  viewerPermission(project: ProjectId): Promise<Permission>;
  listOrganisations(): Promise<Organisation[]>;
  listPendingInvitations(): Promise<Invitation[]>;
  acceptInvitation(id: number): Promise<void>;

  // Projects. A project is never deleted: closing it archives its repository, and any member unarchives it.
  listProjects(): Promise<Project[]>;
  getProject(project: ProjectId): Promise<Project>;
  /** A connected repository that already holds a Grillo project returns that project instead. */
  createProject(input: CreateProjectInput): Promise<Project>;
  /** Admin only. */
  archiveProject(project: ProjectId): Promise<void>;
  /** Admin only. */
  unarchiveProject(project: ProjectId): Promise<void>;
  /** Clones the repository into the project folder, or pulls it, and records it as recent; returns the path. */
  openProjectFolder(project: ProjectId): Promise<string>;
  /** From the settings file, last opened first. */
  listRecentProjects(): Promise<RecentProject[]>;

  // Members: repository access plus one line each in the members file.
  listMembers(project: ProjectId): Promise<Member[]>;
  getMember(project: ProjectId, login: Login): Promise<Member>;
  /** Invites the login to the repository and writes their line in the members file. Admin only. */
  addMember(project: ProjectId, member: NewMember): Promise<Member>;
  updateMember(project: ProjectId, login: Login, patch: MemberPatch): Promise<Member>;
  /** Admin only. */
  removeMember(project: ProjectId, login: Login): Promise<void>;

  // The map: one per project, created by the engine, never deleted.
  createMap(project: ProjectId, map: NewMap): Promise<ProjectMap>;
  getMap(project: ProjectId): Promise<ProjectMap>;
  updateMap(project: ProjectId, patch: MapPatch): Promise<ProjectMap>;

  // Tickets. A ticket is never deleted: closing it ends its life, and reopening undoes that.
  createTicket(project: ProjectId, ticket: NewTicket): Promise<Ticket>;
  getTicket(id: TicketId): Promise<Ticket>;
  listTickets(project: ProjectId, filter?: TicketFilter): Promise<Ticket[]>;
  updateTicket(id: TicketId, patch: TicketPatch): Promise<Ticket>;
  /** A ticket with a decision and no gist line on the map (closed again after a reopen) gets its latest one back. */
  closeTicket(id: TicketId): Promise<CloseResult>;
  /** Closes `id` as a duplicate of `into`, with a decision comment pointing at it. */
  mergeTicket(id: TicketId, into: TicketId): Promise<CloseResult>;
  /** Undoes a close: the ticket's gist line leaves the map's settled list; its decision comments stay. */
  reopenTicket(id: TicketId): Promise<Ticket>;
  /**
   * Takes the ticket for the signed-in member under the claim rule (docs/store-layout.md): assign, re-read,
   * and the earlier assignment wins. Refused with `conflict` when someone else holds it.
   */
  claimTicket(id: TicketId): Promise<Ticket>;
  /** Assigns a ticket in the pool to another member. Refused with `conflict` when someone holds it. */
  sendTicket(id: TicketId, login: Login): Promise<Ticket>;
  /** Moves an unanswered ticket to another member, whoever holds it; `conflict` once any answer exists. */
  reassignTicket(id: TicketId, login: Login): Promise<Ticket>;
  /** Back to the pool, unlocked, its open questions still visible. */
  releaseTicket(id: TicketId): Promise<Ticket>;

  // Questions: part of their ticket. A question code is never reused, so a removed question leaves a gap.
  addQuestion(id: TicketId, text: string): Promise<Ticket>;
  updateQuestion(id: TicketId, code: QuestionCode, text: string): Promise<Ticket>;
  removeQuestion(id: TicketId, code: QuestionCode): Promise<Ticket>;

  // Answers, discussions and decisions: comments on their ticket. Deleting one is how a member undoes it.
  createAnswer(id: TicketId, answer: NewAnswer): Promise<Answer>;
  listAnswers(id: TicketId): Promise<Answer[]>;
  updateAnswer(id: TicketId, answerId: string, text: string): Promise<Answer>;
  deleteAnswer(id: TicketId, answerId: string): Promise<void>;
  createDiscussion(id: TicketId, discussion: NewDiscussion): Promise<Discussion>;
  listDiscussions(id: TicketId): Promise<Discussion[]>;
  updateDiscussion(id: TicketId, discussionId: string, transcript: string): Promise<Discussion>;
  deleteDiscussion(id: TicketId, discussionId: string): Promise<void>;
  /** Writes the resolution comment and the gist line on the map; closing the ticket is `closeTicket`. */
  createDecision(id: TicketId, decision: NewDecision): Promise<Decision>;
  listDecisions(id: TicketId): Promise<Decision[]>;
  updateDecision(id: TicketId, decisionId: string, patch: Partial<Pick<Decision, 'text' | 'gist'>>): Promise<Decision>;
  /** Also removes its gist line from the map. */
  deleteDecision(id: TicketId, decisionId: string): Promise<void>;
  /** Plain member comments not yet turned into answers. */
  listPickupComments(id: TicketId): Promise<PickupComment[]>;

  // Grilling sessions: files in the Grillo folder. Never deleted: removing words is a manual history rewrite.
  createSession(project: ProjectId, session: NewSession): Promise<GrillingSession>;
  getSession(project: ProjectId, sessionId: string): Promise<GrillingSession>;
  listSessions(project: ProjectId): Promise<GrillingSession[]>;
  updateSession(project: ProjectId, sessionId: string, patch: SessionPatch): Promise<GrillingSession>;

  // Sources: files in the Grillo folder. Never changed or deleted: PRD versions cite their codes.
  createSource(project: ProjectId, source: NewSource): Promise<Source>;
  getSource(project: ProjectId, code: SourceCode): Promise<Source>;
  listSources(project: ProjectId): Promise<Source[]>;

  // The PRD structure: created with the project, never deleted.
  getStructure(project: ProjectId): Promise<PrdStructure>;
  updateStructure(project: ProjectId, structure: PrdStructure): Promise<PrdStructure>;

  // PRD versions: every version is kept as written, numbered and dated (PRD section 4.7 item 4).
  createPrdVersion(project: ProjectId, version: NewPrdVersion): Promise<PrdVersion>;
  getPrdVersion(project: ProjectId, version: number): Promise<PrdVersion>;
  listPrdVersions(project: ProjectId): Promise<PrdVersion[]>;

  // Scores: stored with their PRD version; a rerun replaces the score, and null clears it.
  getScore(project: ProjectId, version: number): Promise<Score | null>;
  setScore(project: ProjectId, version: number, score: Score | null): Promise<Score | null>;
}
