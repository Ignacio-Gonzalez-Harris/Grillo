/**
 * Tab panels: what an agent's tab shows, found at build time in `src/renderer/screens/<name>/tab-panel.ts`, so the
 * meeting controls (release 1) and the chat view (release 2) add to the tab without editing this folder.
 *
 * A `tab-panel.ts` exports as `default` one panel or an array of panels. Each panel says which agent kinds it serves,
 * its slot and its priority:
 * - `body`: the tab's main view. Only the highest-priority body panel for the agent's kind is shown; the built-in
 *   terminal has priority 0, so the chat view takes over by registering a body panel with a higher priority.
 * - `controls`: shown in a side column beside the body, highest priority first.
 * - `header`: drawn inside the agent's tab in the tab bar, beside its name and waiting dot, highest priority first.
 */
import { AGENT_KINDS, type AgentInfo, type AgentKind } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import type { ShellContext } from '../../app/screens';

export const PANEL_SLOTS = ['body', 'controls', 'header'] as const;
export type PanelSlot = (typeof PANEL_SLOTS)[number];

/** What a panel is mounted with. */
export interface TabPanelContext {
  /** The agent whose tab this is, as it was when the tab appeared. */
  agent: AgentInfo;
  grillo: GrilloApi;
  shell: ShellContext;
  /** Puts text into the tab's type box (the body panel's `setInput`). */
  setInput(text: string): void;
}

/** What `mount` may return; every member is optional. */
export interface MountedPanel {
  /** Called each time the agent's tab is opened, once the panel is on screen. */
  shown?(): void;
  /** Body panels: puts text into the type box. */
  setInput?(text: string): void;
  /** Called when the agent stops running and its tab goes away. */
  dispose?(): void;
  /** Called just before `dispose`: why the agent ended, if the panel knows, shown under "This agent is not running". */
  endNote?(): string | undefined;
}

export interface TabPanel {
  kinds: readonly AgentKind[] | 'all';
  slot: PanelSlot;
  /** Higher comes first; for `body`, the highest is the only one shown. */
  priority: number;
  /** Mounts once per agent, when its tab appears, into an element that lives as long as the agent runs. */
  mount(el: HTMLElement, context: TabPanelContext): MountedPanel | void;
}

export interface TabPanels {
  /** The body panel an agent of this kind shows. */
  bodyFor(kind: AgentKind): TabPanel;
  /** The panels of one slot for this kind, highest priority first. */
  panelsFor(kind: AgentKind, slot: Exclude<PanelSlot, 'body'>): TabPanel[];
}

/** A panel and where it came from, for error messages. */
interface Found {
  panel: TabPanel;
  source: string;
}

const PANEL_FOLDER = /([^/\\]+)[/\\]tab-panel\.ts$/;

function folderName(path: string): string {
  const match = PANEL_FOLDER.exec(path);
  if (!match) {
    throw new Error(`Tab panel module path '${path}' does not end in <screen>/tab-panel.ts`);
  }
  return match[1];
}

function isKindList(kinds: unknown): kinds is readonly AgentKind[] {
  return (
    Array.isArray(kinds) &&
    kinds.length > 0 &&
    new Set(kinds).size === kinds.length &&
    kinds.every((kind) => (AGENT_KINDS as readonly unknown[]).includes(kind))
  );
}

function isTabPanel(value: unknown): value is TabPanel {
  const candidate = value as Partial<Record<keyof TabPanel, unknown>> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    (candidate.kinds === 'all' || isKindList(candidate.kinds)) &&
    (PANEL_SLOTS as readonly unknown[]).includes(candidate.slot) &&
    typeof candidate.priority === 'number' &&
    Number.isFinite(candidate.priority) &&
    typeof candidate.mount === 'function'
  );
}

function panelsOf(folder: string, module: unknown): Found[] {
  const exported = (module as { default?: unknown } | null)?.default;
  const panels = Array.isArray(exported) ? exported : [exported];
  if (panels.length === 0 || !panels.every(isTabPanel)) {
    throw new Error(
      `Folder '${folder}' must export as default from its tab-panel.ts a panel or a non-empty array of panels, each ` +
        "with kinds ('all' or a list of agent kinds, none twice), slot ('body', 'controls' or 'header'), a finite " +
        'priority and mount(el, context)',
    );
  }
  return panels.map((panel) => ({ panel, source: `'${folder}'` }));
}

const serves = (panel: TabPanel, kind: AgentKind) => panel.kinds === 'all' || panel.kinds.includes(kind);
const byPriority = (a: Found, b: Found) => b.panel.priority - a.panel.priority;

/** Refuses two body panels that would tie for the same kind: which one shows would be a guess. */
function bodiesByKind(found: readonly Found[]): Map<AgentKind, TabPanel> {
  const bodies = new Map<AgentKind, TabPanel>();
  for (const kind of AGENT_KINDS) {
    const [top, next] = found.filter(({ panel }) => panel.slot === 'body' && serves(panel, kind)).sort(byPriority);
    if (!top) {
      throw new Error(`No body panel serves '${kind}' agents`);
    }
    if (next && next.panel.priority === top.panel.priority) {
      throw new Error(
        `Body panels ${top.source} and ${next.source} both serve '${kind}' agents at priority ${top.panel.priority}`,
      );
    }
    bodies.set(kind, top.panel);
  }
  return bodies;
}

/**
 * Builds the panels from discovered `tab-panel.ts` modules (keyed by path) plus the built-in ones, such as the
 * terminal body. Throws, naming the folder, on a module that exports something else.
 */
export function registerTabPanels(modules: Record<string, unknown>, builtIn: readonly TabPanel[]): TabPanels {
  const found: Found[] = [
    ...builtIn.map((panel) => ({ panel, source: 'built in' })),
    ...Object.entries(modules)
      .map(([path, module]) => ({ folder: folderName(path), module }))
      .sort((a, b) => a.folder.localeCompare(b.folder))
      .flatMap(({ folder, module }) => panelsOf(folder, module)),
  ];
  const bodies = bodiesByKind(found);
  return {
    bodyFor: (kind) => bodies.get(kind) as TabPanel,
    panelsFor: (kind, slot) =>
      found
        .filter(({ panel }) => panel.slot === slot && serves(panel, kind))
        .sort(byPriority)
        .map(({ panel }) => panel),
  };
}

/**
 * Finds every `src/renderer/screens/<name>/tab-panel.ts` at build time. `@screens` is the alias screen discovery
 * uses (a fixture folder in tests).
 */
export function loadTabPanels(builtIn: readonly TabPanel[]): TabPanels {
  return registerTabPanels(import.meta.glob('@screens/*/tab-panel.ts', { eager: true }), builtIn);
}
