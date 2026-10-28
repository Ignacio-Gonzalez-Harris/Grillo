import type { TerminalSize, TerminalView } from './terminal-view';

/** A stand-in for the xterm.js terminal, for tests: records what it shows and lets the test type and resize. */
export class FakeTerminalView implements TerminalView {
  cols = 80;
  rows = 24;
  readonly written: string[] = [];
  openedIn: HTMLElement | undefined;
  focusCount = 0;
  disposed = false;
  /** The size `fit` takes, as the element's size would give it. */
  sizeToFit: TerminalSize | undefined;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly resizeListeners = new Set<(size: TerminalSize) => void>();

  open(el: HTMLElement): void {
    this.openedIn = el;
  }

  write(data: string): void {
    this.written.push(data);
  }

  onData(listener: (data: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onResize(listener: (size: TerminalSize) => void): () => void {
    this.resizeListeners.add(listener);
    return () => this.resizeListeners.delete(listener);
  }

  fit(): void {
    const size = this.sizeToFit;
    if (!size || (size.cols === this.cols && size.rows === this.rows)) return;
    this.cols = size.cols;
    this.rows = size.rows;
    this.resizeListeners.forEach((listener) => listener({ ...size }));
  }

  focus(): void {
    this.focusCount += 1;
  }

  dispose(): void {
    this.disposed = true;
  }

  /** The member types into the terminal. */
  type(data: string): void {
    this.dataListeners.forEach((listener) => listener(data));
  }

  /** Everything the terminal shows, as one text. */
  get text(): string {
    return this.written.join('');
  }
}
