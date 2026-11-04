/**
 * The store's IPC contract: one invoke channel per `Store` method (`store:<method>`), plus the app
 * settings (`settings:get`, `settings:set`). The renderer reaches the store through `createStoreClient`,
 * which gives it the same `Store` interface the main process has.
 */
import type { PullRequestNotice, Store } from '../main/store/store';
import type { GrilloApi } from './ipc';

/** Why a store call was refused. Every backend throws only this, so callers handle one error type. */
export type StoreErrorKind =
  | 'not-found'
  | 'conflict'
  | 'read-only'
  | 'forbidden'
  | 'invalid'
  | 'not-implemented'
  | 'backend';

export class StoreError extends Error {
  readonly kind: StoreErrorKind;

  constructor(kind: StoreErrorKind, message: string) {
    super(message);
    this.name = 'StoreError';
    this.kind = kind;
  }
}

/** A damaged record's reason (`Damage`) ended as a sentence, so the screen's hint can follow it. */
export function asSentence(reason: string): string {
  const text = reason.trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Every method of `Store`: the bridge registers one channel per name. */
export const STORE_METHODS = [
  'currentMember',
  'viewerPermission',
  'isPublicRepository',
  'signedInLogin',
  'listOrganisations',
  'listRepositories',
  'listPendingInvitations',
  'acceptInvitation',
  'listProjects',
  'getProject',
  'createProject',
  'archiveProject',
  'unarchiveProject',
  'openProjectFolder',
  'listRecentProjects',
  'listMembers',
  'getMember',
  'addMember',
  'updateMember',
  'removeMember',
  'createMap',
  'getMap',
  'updateMap',
  'createTicket',
  'getTicket',
  'listTickets',
  'updateTicket',
  'tagTicketByHand',
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
  'listProjectPickupComments',
  'createSession',
  'getSession',
  'listSessions',
  'updateSession',
  'createSource',
  'getSource',
  'listSources',
  'getStructure',
  'updateStructure',
  'createPrdVersion',
  'getPrdVersion',
  'listPrdVersions',
  'getScore',
  'setScore',
] as const satisfies readonly (keyof Store)[];

export type StoreMethod = (typeof STORE_METHODS)[number];

// Fails to compile when a Store method is missing from STORE_METHODS.
const everyMethodListed: Record<Exclude<keyof Store, StoreMethod>, never> = {};
void everyMethodListed;

export type StoreChannel<M extends StoreMethod = StoreMethod> = `store:${M}`;

/** The event a window hears when one of its saves became a pull request because main is protected. */
export const PULL_REQUEST_CHANNEL = 'store:pull-request';

export function storeChannel<M extends StoreMethod>(method: M): StoreChannel<M> {
  return `store:${method}`;
}

/**
 * What a store channel answers. A refusal travels as data, because Electron keeps only the message of an
 * error thrown across IPC; the client turns it back into a `StoreError` with its kind.
 */
export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: { kind: StoreErrorKind; message: string } };

/** What a settings value may be: anything that survives a JSON round trip. */
export type SettingValue = string | number | boolean | null | SettingValue[] | { [key: string]: SettingValue };

type StoreInvokeChannels = {
  [M in StoreMethod as StoreChannel<M>]: {
    request: Parameters<Store[M]>;
    response: StoreResult<Awaited<ReturnType<Store[M]>>>;
  };
};

declare module './ipc' {
  // The store's channels join the app's channel map; settings values must survive a JSON round trip.
  interface InvokeChannels extends StoreInvokeChannels {
    'settings:get': { request: { key: string; defaultValue: SettingValue }; response: SettingValue };
    'settings:set': { request: { key: string; value: SettingValue }; response: void };
  }
  interface EventChannels {
    'store:pull-request': PullRequestNotice;
  }
}

type AnyStoreMethod = (...args: unknown[]) => Promise<unknown>;
type AnyInvoke = (channel: string, payload: unknown) => Promise<StoreResult<unknown>>;

/** The renderer's `Store`: every call goes through `window.grillo`, and refusals arrive as `StoreError`. */
export function createStoreClient(api: GrilloApi): Store {
  const invoke = api.invoke as unknown as AnyInvoke;
  const call =
    (method: StoreMethod): AnyStoreMethod =>
    async (...args) => {
      const result = await invoke(storeChannel(method), args);
      if (!result.ok) {
        throw new StoreError(result.error.kind, result.error.message);
      }
      return result.value;
    };
  return Object.fromEntries(STORE_METHODS.map((method) => [method, call(method)])) as unknown as Store;
}
