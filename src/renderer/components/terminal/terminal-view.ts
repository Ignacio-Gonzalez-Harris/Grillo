/**
 * The terminal an agent's tab draws: xterm.js with its fit addon, behind a small interface so the wiring to the
 * agent runtime is tested with a fake (`fake-terminal-view.ts`). Colours and font come from the terminal tokens.
 */
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import type { Unsubscribe } from '../../../shared/ipc';

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** The part of a terminal the agent tab uses. */
export interface TerminalView {
  readonly cols: number;
  readonly rows: number;
  /** Draws the terminal inside `el`; a later call moves it there (the tab's screen is rebuilt on every visit). */
  open(el: HTMLElement): void;
  /** Shows output; output written before `open` is kept and shown once the terminal is drawn. */
  write(data: string): void;
  /** Keystrokes the member types into the terminal. */
  onData(listener: (data: string) => void): Unsubscribe;
  /** The terminal changed its number of columns or rows. */
  onResize(listener: (size: TerminalSize) => void): Unsubscribe;
  /** Fits the columns and rows to the element the terminal is drawn in. */
  fit(): void;
  focus(): void;
  dispose(): void;
}

/** Reads one design token (a CSS custom property of the page) as text. */
export type ReadToken = (name: string) => string;

/** The terminal tokens of theme/tokens.css; terminal.css lets the panel's own background show through. */
export function xtermOptions(readToken: ReadToken): ITerminalOptions {
  return {
    allowTransparency: true,
    fontFamily: readToken('--font-family-mono'),
    fontSize: Number.parseFloat(readToken('--font-size-s')),
    theme: {
      background: readToken('--color-terminal-bg'),
      foreground: readToken('--color-terminal-text'),
      cursor: readToken('--color-terminal-prompt'),
    },
  };
}

function pageToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The real terminal: xterm.js, refitted whenever the element it is drawn in changes size. */
export function createXtermView(readToken: ReadToken = pageToken): TerminalView {
  const terminal = new Terminal(xtermOptions(readToken));
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  const fit = (): void => fitAddon.fit();
  const resizeObserver = new ResizeObserver(fit);

  return {
    get cols() {
      return terminal.cols;
    },
    get rows() {
      return terminal.rows;
    },
    open(el) {
      resizeObserver.disconnect();
      // xterm.js draws itself once; a later open only moves what it drew.
      if (terminal.element) el.append(terminal.element);
      else terminal.open(el);
      resizeObserver.observe(el);
    },
    write: (data) => terminal.write(data),
    onData(listener) {
      const subscription = terminal.onData(listener);
      return () => subscription.dispose();
    },
    onResize(listener) {
      const subscription = terminal.onResize(listener);
      return () => subscription.dispose();
    },
    fit,
    focus: () => terminal.focus(),
    dispose() {
      resizeObserver.disconnect();
      terminal.dispose();
    },
  };
}
