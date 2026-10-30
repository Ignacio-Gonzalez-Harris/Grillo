/**
 * Grillo's records (PRD section 6.1), as every screen and backend sees them. Where each one lives in
 * GitHub is pinned in docs/store-layout.md. A field that may have no value is typed `| null`; nothing is
 * optional by omission, except `damaged`, which only a list item that could not be read carries. Every record
 * survives a structured clone, so it crosses IPC unchanged.
 */

/**
 * Set on an item of a list (`listProjects`, `listTickets`, `listPrdVersions`) whose record could not be read: a
 * damaged file or issue, or a project folder that cannot be brought up to date. It says why, in words a screen
 * shows; the item's other fields hold only what could be read, and the list still returns every other item.
 */
export interface Damage {
  damaged?: string;
}

/** A GitHub login, such as `ada-example`. */
export type Login = string;

/** A moment as an ISO 8601 string in UTC, such as `2026-10-24T09:12:52.000Z`. */
export type IsoDateTime = string;

/** A project is named by its repository: `<owner>/<repo>`. */
export type ProjectId = string;

/** `S<n>`: a source's stable code. */
export type SourceCode = string;

/** `Q<ticket issue number>.<k>`: a question's stable code. */
export type QuestionCode = string;

export interface RepositoryRef {
  owner: string;
  name: string;
}

/** The repository permission GitHub gives the signed-in member. */
export type Permission = 'admin' | 'write' | 'read';

export interface PrdSection {
  name: string;
  /** One line saying what the section holds. */
  note: string;
}

/** The project's ordered list of PRD sections. */
export interface PrdStructure {
  sections: PrdSection[];
}

export interface Member {
  login: Login;
  /** From GitHub; null when the account has not set one. */
  name: string | null;
  /** From GitHub; null when the account keeps it private. */
  email: string | null;
  /** Free text, kept by Grillo in the members file. */
  role: string;
  /** Free-text subject tags, kept by Grillo in the members file. */
  domains: string[];
}

export interface Project extends Damage {
  /** `<owner>/<repo>`. */
  id: ProjectId;
  name: string;
  repository: RepositoryRef;
  structure: PrdStructure;
  /** The members file's lines, with the GitHub identity of each member. */
  members: Member[];
  /** Closing a project archives its repository (PRD section 4.8): readable, nothing changes. */
  archived: boolean;
}

/** One gist line on the map per closed ticket. */
export interface SettledLine {
  ticket: number;
  gist: string;
}

/** Where things stand in a project; one issue labelled `wayfinder:map`. */
export interface ProjectMap {
  /** The map issue's number. */
  number: number;
  destination: string;
  notes: string;
  settled: SettledLine[];
  /** Questions that cannot be asked precisely yet. */
  fog: string[];
  outOfScope: string[];
}

/** The four wayfinder kinds, carried as `wayfinder:<kind>` labels. */
export type TicketKind = 'grilling' | 'research' | 'prototype' | 'task';

export type TicketState = 'open' | 'closed';

/** A ticket is named by its project and its issue number. */
export interface TicketId {
  project: ProjectId;
  number: number;
}

/** One item inside a ticket. */
export interface Question {
  code: QuestionCode;
  text: string;
  /** True once an answer for this question is recorded. */
  answered: boolean;
}

export interface Ticket extends Damage {
  id: TicketId;
  title: string;
  /** The ticket's own question, as wayfinder writes it. */
  question: string;
  whyItMatters: string;
  assumptions: string[];
  kind: TicketKind;
  /** Domain tags; empty when the ticket is untagged or tagged "no domain". */
  domains: string[];
  /** The visible "no domain" tag (`domain:none`): open to anyone. Never set together with `domains`. */
  noDomain: boolean;
  /** Issue numbers of the tickets this one waits for. */
  blockers: number[];
  /** The claim: whoever took it or was sent it; null while it sits in the pool. */
  assignee: Login | null;
  state: TicketState;
  /** Set when the ticket was merged into another (closed as its duplicate). */
  duplicateOf: number | null;
  questions: Question[];
}

/** How an answer reached the store when no member typed it in Grillo: `via:` in the comment header. */
export type Via = 'github' | 'generic-agent';

/** What every answer, discussion and decision comment carries in its header (docs/store-layout.md). */
export interface CommentHeader {
  /** The comment's id in the store. */
  id: string;
  ticket: TicketId;
  /** Who recorded it. */
  who: Login;
  when: IsoDateTime;
  sources: SourceCode[];
  via: Via | null;
}

export interface Answer extends CommentHeader {
  question: QuestionCode;
  text: string;
}

export interface Discussion extends CommentHeader {
  question: QuestionCode;
  /** The transcript segment, word for word. */
  transcript: string;
  /** The session file it was cut from, such as `.grillo/sessions/2026-10-24-091500.md`; null when typed. */
  sessionFile: string | null;
}

export interface Decision extends CommentHeader {
  /** The ticket's final answer. */
  text: string;
  /** The one line the map's settled list shows for this ticket. */
  gist: string;
}

/** A plain member comment on a ticket (written in GitHub's own app) not yet turned into an answer. */
export interface PickupComment {
  id: string;
  ticket: TicketId;
  author: Login;
  when: IsoDateTime;
  text: string;
}

export interface Consent {
  /** The host who ticked "everyone here agreed". */
  by: Login;
  at: IsoDateTime;
}

export interface GrillingSession {
  /** The file name without `.md`: `<date>-<time>`, such as `2026-10-24-091500` (UTC, `YYYY-MM-DD-HHMMSS`). */
  id: string;
  date: IsoDateTime;
  present: Login[];
  /** Null until the host ticks consent; recording stays off until then. */
  consent: Consent | null;
  transcript: string;
}

export type SourceKind = 'meeting' | 'own-time-answer' | 'pasted-text' | 'document';

export interface Source {
  code: SourceCode;
  kind: SourceKind;
  /** Who said or sent it, in free text ("Ben Example, product"). */
  who: string;
  when: IsoDateTime;
  /** Where it came from ("kick-off call", "email to Ada"). */
  where: string;
  /** The text or segment, word for word. */
  text: string;
}

/** One number from 0 to 10 with one comment: what is weak, why, and a concrete suggestion. */
export interface ScoreItem {
  name: string;
  mark: number;
  comment: string;
}

export interface Score {
  overall: number;
  criteria: ScoreItem[];
  sections: ScoreItem[];
}

export interface PrdVersion extends Damage {
  number: number;
  date: IsoDateTime;
  /** Markdown with `[S<n>, Q<n>.<k>]` codes. */
  body: string;
  /** The audit appendix, Markdown. */
  appendix: string;
  /** Null until the version is scored. */
  score: Score | null;
}

export interface Organisation {
  login: Login;
  name: string | null;
}

export interface Invitation {
  id: number;
  repository: RepositoryRef;
  inviter: Login;
  createdAt: IsoDateTime;
}

export interface RecentProject {
  project: ProjectId;
  lastOpened: IsoDateTime;
}

/** PRD section 6.1 calls the record "Map"; `ProjectMap` keeps it apart from the JavaScript Map. */
export type Map = ProjectMap;
