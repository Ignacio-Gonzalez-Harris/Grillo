import { StoreError, type Store, type StoreMethod } from '../../store';
import type { GithubDeps } from '..';

/**
 * The store methods kept in GitHub Issues: the map, tickets, questions, answers, discussions, decisions and
 * the claim rule (docs/store-layout.md). A stub until its backend story fills it.
 */
export const ISSUES_METHODS = [
  'createMap',
  'getMap',
  'updateMap',
  'createTicket',
  'getTicket',
  'listTickets',
  'updateTicket',
  'closeTicket',
  'mergeTicket',
  'reopenTicket',
  'claimTicket',
  'sendTicket',
  'reassignTicket',
  'releaseTicket',
  'addQuestion',
  'updateQuestion',
  'removeQuestion',
  'createAnswer',
  'listAnswers',
  'updateAnswer',
  'deleteAnswer',
  'createDiscussion',
  'listDiscussions',
  'updateDiscussion',
  'deleteDiscussion',
  'createDecision',
  'listDecisions',
  'updateDecision',
  'deleteDecision',
  'listPickupComments',
] as const satisfies readonly StoreMethod[];

type IssuesStore = Pick<Store, (typeof ISSUES_METHODS)[number]>;

export function createIssuesStore(_deps: GithubDeps): IssuesStore {
  const refuse = async (): Promise<never> => {
    throw new StoreError('not-implemented', 'The GitHub issues backend is not implemented yet');
  };
  return Object.fromEntries(ISSUES_METHODS.map((method) => [method, refuse])) as unknown as IssuesStore;
}
