import './shell.css';
import logoUrl from '../assets/grillo-logo.png';
import type { AgentId, AgentInfo } from '../../shared/agents';
import type { GrilloApi } from '../../shared/ipc';
import { glassPanel } from '../theme/components';
import {
  AGENT_SCREEN,
  GENERIC_AGENT_SCREEN,
  SETUP_CHECK_SCREEN,
  START_SCREEN,
  UNBUILT_SCREEN_NAMES,
} from './navigation';
import type { ScreenParams, ScreenRegistry, ShellContext } from './screens';
import { createTabBar, type ActiveTab } from './tab-bar';
import { createUpdatePopup } from './update-popup';

export interface ShellOptions {
  grillo: GrilloApi;
  screens: ScreenRegistry;
}

export interface Shell {
  navigate(screenId: string, params?: ScreenParams): void;
  agentTabHeader(agentId: AgentId): HTMLElement | undefined;
  /** Closes the open screen and stops listening to the agent runtime. */
  dispose(): void;
}

function unbuiltName(screenId: string): string {
  return UNBUILT_SCREEN_NAMES.get(screenId) ?? screenId;
}

function emptyState(title: string): HTMLElement {
  const message = document.createElement('p');
  message.className = 'muted';
  message.textContent = `${title} is not built yet.`;
  const panel = glassPanel([message]);
  panel.classList.add('empty-screen');
  return panel;
}

/**
 * The frame every screen sits in: the app window with its title bar, the tab bar and the content area. Screens come
 * from the registry; agent tabs come from the agent runtime's list (`agents:list`, then `agents:list-changed`). The
 * update pop-up covers the whole window when a newer version is found.
 */
export function createShell(root: HTMLElement, { grillo, screens }: ShellOptions): Shell {
  let agents: readonly AgentInfo[] = [];
  let current: { screenId: string; params: ScreenParams } = { screenId: START_SCREEN, params: {} };
  let closeScreen: (() => void) | undefined;

  const context = document.createElement('span');
  context.className = 'context';
  const logo = document.createElement('img');
  logo.className = 'logo';
  logo.src = logoUrl;
  logo.alt = '';
  const brand = document.createElement('strong');
  brand.textContent = 'Grillo';
  const titlebar = document.createElement('header');
  titlebar.className = 'titlebar';
  titlebar.append(logo, brand, context);

  const tabBar = createTabBar({
    openScreen: (screenId) => navigate(screenId),
    openAgent: (agentId) => navigate(AGENT_SCREEN, { agentId }),
    openGenericAgent: () => navigate(GENERIC_AGENT_SCREEN),
  });

  const content = document.createElement('main');
  content.className = 'window-body';

  const updatePopup = createUpdatePopup({
    grillo,
    screenShowsOffer: () => current.screenId === SETUP_CHECK_SCREEN,
    behind: [tabBar.el, content],
  });

  const appWindow = glassPanel([titlebar, tabBar.el, content, updatePopup.root]);
  appWindow.classList.add('window', 'overlay-host');
  const frame = document.createElement('div');
  frame.className = 'shell';
  frame.append(appWindow);
  root.replaceChildren(frame);

  const agentTabListeners = new Set<(list: readonly AgentInfo[]) => void>();
  function tellAgentTabListeners(listener: (list: readonly AgentInfo[]) => void): void {
    try {
      listener(agents);
    } catch (error) {
      console.error('An agent-tab listener failed; the other listeners still ran.', error);
    }
  }

  const shellContext: ShellContext = {
    grillo,
    navigate: (screenId, params) => navigate(screenId, params),
    agentTabHeader: (agentId) => tabBar.agentTabHeader(agentId),
    onAgentTabs(listener) {
      agentTabListeners.add(listener);
      tellAgentTabListeners(listener);
      return () => {
        agentTabListeners.delete(listener);
      };
    },
  };

  function activeTabFor(screenId: string, params: ScreenParams): ActiveTab {
    const agentId = params['agentId'];
    return screenId === AGENT_SCREEN && agentId !== undefined ? { agentId } : { screenId };
  }

  function titleFor(screenId: string, params: ScreenParams): string {
    if (screenId === AGENT_SCREEN) {
      const agent = agents.find(({ id }) => id === params['agentId']);
      if (agent) return agent.title;
    }
    return screens.get(screenId)?.title ?? unbuiltName(screenId);
  }

  function navigate(screenId: string, params: ScreenParams = {}): void {
    closeScreen?.();
    closeScreen = undefined;
    current = { screenId, params };
    content.replaceChildren();
    tabBar.setActive(activeTabFor(screenId, params));
    context.textContent = titleFor(screenId, params);

    const screen = screens.get(screenId);
    if (!screen) {
      content.append(emptyState(unbuiltName(screenId)));
      return;
    }
    const slot = document.createElement('div');
    slot.className = 'screen';
    content.append(slot);
    closeScreen = screen.mount(slot, params, shellContext) ?? undefined;
  }

  let heardFromRuntime = false;
  function showAgents(list: readonly AgentInfo[]): void {
    agents = list;
    tabBar.setAgents(list);
    [...agentTabListeners].forEach(tellAgentTabListeners);
    // An agent renames its tab as it moves on; the title bar follows when that tab is open.
    context.textContent = titleFor(current.screenId, current.params);
  }
  const stopListening = grillo.on('agents:list-changed', (list) => {
    heardFromRuntime = true;
    showAgents(list);
  });
  grillo.invoke('agents:list', undefined).then(
    (list) => {
      // An `agents:list-changed` that arrived first is newer than this answer.
      if (!heardFromRuntime) showAgents(list);
    },
    (error: unknown) => console.warn('Grillo could not read the agent list; the agent tabs stay empty.', error),
  );

  const stopScreens = [...screens.values()].flatMap((screen) => screen.start?.(shellContext) ?? []);

  navigate(START_SCREEN);

  return {
    navigate,
    agentTabHeader: (agentId) => tabBar.agentTabHeader(agentId),
    dispose() {
      stopListening();
      updatePopup.dispose();
      closeScreen?.();
      closeScreen = undefined;
      stopScreens.forEach((stop) => stop());
      agentTabListeners.clear();
    },
  };
}
