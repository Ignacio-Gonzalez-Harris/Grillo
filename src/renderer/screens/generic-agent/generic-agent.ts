/**
 * The generic agent tab (PRD section 4.6 item 9, section 5 screen 7; prototype `screen-generic-agent-tab`): "+" on
 * the tab bar opens this naming dialog, the member names the tab, and Open agent starts a generic agent in the project
 * folder with `/grillo-generic` (`resources/skills/README.md`, Commands), then opens the agent's own tab. The
 * prototype's other two states, a pasted email with a clash and own words as the source, are that agent's terminal
 * content, shown through the agent tab. Opened with `{ project: '<owner>/<repo>' }`, or with nothing for the project
 * opened last.
 */
import './generic-agent.css';
import type { Store } from '../../../main/store/store';
import type { ProjectId } from '../../../main/store/types';
import { agentTitle } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import { AGENT_SCREEN } from '../../app/navigation';
import type { ScreenParams } from '../../app/screens';
import { button, dialog } from '../../theme/components';
import { el, messageOf, note } from '../own-time/view';
import { projectFolder, projectToShow } from '../prd/data';

export const GENERIC_COMMAND = '/grillo-generic';
export const HELP_TEXT = 'A generic agent can change anything the engine can, after it shows clashes and asks you.';
export const NO_PROJECT = 'Open a project from the Project tab to start a generic agent in it.';
/** Where Cancel goes: the project's map, or the project screen when no project is open. */
const MAP_SCREEN = 'map';
const PROJECT_SCREEN = 'project-creation';

export interface GenericAgentDeps {
  store: Store;
  grillo: GrilloApi;
  navigate(screenId: string, params?: ScreenParams): void;
}

type Phase = { name: 'loading' } | { name: 'no-project' } | { name: 'ready'; project: ProjectId };

export function mountGenericAgent(container: HTMLElement, params: ScreenParams, deps: GenericAgentDeps): () => void {
  const { store, grillo, navigate } = deps;
  let disposed = false;
  let phase: Phase = { name: 'loading' };
  let starting = false;

  const name = document.createElement('input');
  name.type = 'text';
  const field = el('label', 'field', ['Tab name', name]);
  const status = el('div', 'status');
  const open = button('Open agent', { variant: 'primary', onClick: () => void openAgent() });
  const cancel = button('Cancel', { onClick: () => leave() });
  const naming = dialog({
    title: 'New generic agent',
    body: [field, el('p', 'small muted', [HELP_TEXT]), status],
    actions: [cancel, open],
  });
  naming.setAttribute('aria-label', 'Name the new tab');
  container.replaceChildren(el('div', 'generic-agent', [naming]));

  const tabName = () => name.value.trim();
  const canOpen = () => phase.name === 'ready' && tabName() !== '' && !starting;

  function refresh(): void {
    open.disabled = !canOpen();
    cancel.disabled = starting;
    name.disabled = starting;
  }

  function show(message: HTMLElement | null): void {
    status.replaceChildren(...(message ? [message] : []));
  }

  async function openAgent(): Promise<void> {
    if (!canOpen() || phase.name !== 'ready') return;
    const { project } = phase;
    starting = true;
    show(null);
    refresh();
    try {
      const folder = await projectFolder(store, project);
      const agentId = await grillo.invoke('agents:start', {
        kind: 'generic',
        folder,
        firstMessage: GENERIC_COMMAND,
        title: agentTitle('generic', tabName()),
      });
      if (!disposed) navigate(AGENT_SCREEN, { agentId });
    } catch (error) {
      if (disposed) return;
      starting = false;
      show(note(`The agent did not start: ${messageOf(error)}`, 'err'));
      refresh();
    }
  }

  function leave(): void {
    if (phase.name === 'ready') navigate(MAP_SCREEN, { project: phase.project });
    else navigate(PROJECT_SCREEN);
  }

  name.addEventListener('input', refresh);
  name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void openAgent();
  });
  refresh();

  async function load(): Promise<void> {
    try {
      const project = await projectToShow(store, params);
      if (disposed) return;
      phase = project === null ? { name: 'no-project' } : { name: 'ready', project };
      if (project === null) show(note(NO_PROJECT, 'warn'));
    } catch (error) {
      if (disposed) return;
      phase = { name: 'no-project' };
      show(note(messageOf(error), 'err'));
    }
    refresh();
  }

  void load();
  name.focus();

  return () => {
    disposed = true;
  };
}
