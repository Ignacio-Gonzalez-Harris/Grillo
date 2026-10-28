import '../../components/terminal/terminal.css';
import { connectAgentTerminal, sendLine } from '../../components/terminal/agent-terminal';
import { createXtermView, type TerminalView } from '../../components/terminal/terminal-view';
import { createTypeBox } from '../../components/terminal/type-box';
import type { TabPanel } from './tab-panels';

/** The priority of the built-in body; release 2's chat view registers a body panel above it. */
export const TERMINAL_PRIORITY = 0;

/**
 * The default body of every agent's tab (release 1): the raw Claude Code terminal, wired to the agent runtime, with
 * the type box under it. Typing works in both, always.
 */
export function terminalPanel(createView: () => TerminalView = createXtermView): TabPanel {
  return {
    kinds: 'all',
    slot: 'body',
    priority: TERMINAL_PRIORITY,
    mount(el, { agent, grillo }) {
      const view = createView();
      const terminal = connectAgentTerminal(grillo, agent.id, view);
      // The panel carries the padding; xterm.js fits itself to the unpadded screen inside it.
      const screen = document.createElement('div');
      screen.className = 'agent-terminal-screen';
      const panel = document.createElement('div');
      panel.className = 'agent-terminal';
      panel.append(screen);
      const typeBox = createTypeBox((text) => void sendLine(grillo, agent.id, text));
      el.append(panel, typeBox.el);
      return {
        shown() {
          view.open(screen);
          view.fit();
          terminal.syncSize();
          view.focus();
        },
        setInput: typeBox.setValue,
        dispose() {
          terminal.dispose();
          view.dispose();
        },
      };
    },
  };
}
