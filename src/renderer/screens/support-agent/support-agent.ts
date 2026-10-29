/**
 * The Support tab's screen (PRD section 5 last paragraph, section 4.6 item 7; prototype `screen-support-agent-tab`):
 * opening Support the first time starts the support agent in the project folder with `/grillo-support`
 * (`resources/skills/README.md`, Commands) and opens the agent's own tab, where the member talks to it. A support
 * agent that already runs is opened instead; a second one is never started. Opened with `{ project: '<owner>/<repo>' }`,
 * or with nothing for the project opened last.
 */
import './support-agent.css';
import type { Store } from '../../../main/store/store';
import type { AgentId } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import { AGENT_SCREEN } from '../../app/navigation';
import type { ScreenParams } from '../../app/screens';
import { button } from '../../theme/components';
import { el, messageOf, note } from '../own-time/view';
import { projectFolder, projectToShow } from '../prd/data';

export const SUPPORT_COMMAND = '/grillo-support';
/** The support agent's tab name, as the prototype's tab bar shows it. */
export const SUPPORT_TITLE = 'Support';
export const NO_PROJECT = 'Open a project from the Project tab to start the support agent in it.';
const TAGLINE = '· tips, side questions and messages to other agents';

export interface SupportAgentDeps {
  store: Store;
  grillo: GrilloApi;
  navigate(screenId: string, params?: ScreenParams): void;
}

/** The start in flight, shared by every opening, so pressing Support twice never starts two agents. */
let starting: Promise<AgentId> | undefined;

async function runningSupportAgent(grillo: GrilloApi): Promise<AgentId | undefined> {
  const agents: unknown = await grillo.invoke('agents:list', undefined);
  if (!Array.isArray(agents)) return undefined;
  return (agents as Array<{ id?: unknown; kind?: unknown } | null>).find(
    (agent) => agent?.kind === 'support' && typeof agent.id === 'string',
  )?.id as AgentId | undefined;
}

function startSupportAgent(grillo: GrilloApi, folder: string): Promise<AgentId> {
  starting ??= grillo
    .invoke('agents:start', { kind: 'support', folder, firstMessage: SUPPORT_COMMAND, title: SUPPORT_TITLE })
    .finally(() => {
      starting = undefined;
    });
  return starting;
}

/** The prototype's "Opened the Support tab" line, shown while the agent starts. */
function startingLine(): HTMLElement {
  return el('p', 'chat-event', [
    'Opening the Support tab: Grillo starts the support agent with ',
    el('code', '', [SUPPORT_COMMAND]),
    '.',
  ]);
}

/** The support agent's card: the prototype's chat header, then the line or note that says where the start is. */
function card(status: HTMLElement): HTMLElement {
  const head = el('div', 'chat-head', [el('span', 'strong', ['Support agent']), el('span', 'small muted', [TAGLINE])]);
  return el('div', 'card chat', [head, status]);
}

export function mountSupportAgent(container: HTMLElement, params: ScreenParams, deps: SupportAgentDeps): () => void {
  const { store, grillo, navigate } = deps;
  let disposed = false;
  const status = el('div', 'msgs');
  container.replaceChildren(el('div', 'support-agent', [card(status)]));

  function show(...messages: HTMLElement[]): void {
    status.replaceChildren(...messages);
  }

  async function open(): Promise<void> {
    show(startingLine());
    try {
      let agentId = starting ? await starting : await runningSupportAgent(grillo);
      if (agentId === undefined) {
        const project = await projectToShow(store, params);
        if (disposed) return;
        if (project === null) {
          show(note(NO_PROJECT, 'warn'));
          return;
        }
        agentId = await startSupportAgent(grillo, await projectFolder(store, project));
      }
      if (!disposed) navigate(AGENT_SCREEN, { agentId });
    } catch (error) {
      if (disposed) return;
      const retry = button('Try again', { onClick: () => void open() });
      show(note(`The support agent did not start: ${messageOf(error)}`, 'err'), el('div', 'row', [retry]));
    }
  }

  void open();

  return () => {
    disposed = true;
  };
}
