/**
 * The typed IPC contract between the main process and the renderer.
 *
 * This file only holds the empty channel maps. Each feature adds its own channels in
 * `src/shared/<feature>.ts`, owned by that feature's story, by augmenting the maps:
 *
 *   declare module './ipc' {
 *     interface InvokeChannels { 'projects:list': { request: void; response: Project[] } }
 *     interface EventChannels { 'projects:changed': Project[] }
 *   }
 *
 * InvokeChannels: the renderer asks, main answers (`window.grillo.invoke` / `handle`).
 * EventChannels: main pushes, the renderer listens (`send` / `window.grillo.on`).
 */

// The maps start empty on purpose: features fill them through declaration merging.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InvokeChannels {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EventChannels {}

export type InvokeChannel = keyof InvokeChannels & string;
export type InvokeRequest<C extends InvokeChannel> = InvokeChannels[C] extends { request: infer R } ? R : never;
export type InvokeResponse<C extends InvokeChannel> = InvokeChannels[C] extends { response: infer R } ? R : never;

export type EventChannel = keyof EventChannels & string;
export type EventPayload<C extends EventChannel> = EventChannels[C];

/** Stops a listener added with `on`. */
export type Unsubscribe = () => void;

/** What the preload script exposes to the renderer as `window.grillo`. */
export interface GrilloApi {
  invoke<C extends InvokeChannel>(channel: C, payload: InvokeRequest<C>): Promise<InvokeResponse<C>>;
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): Unsubscribe;
}
