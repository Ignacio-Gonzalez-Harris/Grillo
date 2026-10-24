import type { Pty, PtySpawnOptions } from './runtime';

/** A stand-in for a node-pty terminal, for tests: records what was typed and lets the test play Claude Code. */
export class FakePty implements Pty {
  readonly written: string[] = [];
  readonly sizes: Array<[number, number]> = [];
  killed = false;
  private readonly dataListeners: Array<(data: string) => void> = [];
  private readonly exitListeners: Array<(event: { exitCode: number }) => void> = [];

  constructor(
    readonly file: string,
    readonly args: string[],
    readonly options: PtySpawnOptions,
  ) {}

  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
  }

  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exitListeners.push(listener);
  }

  write(data: string): void {
    this.written.push(data);
  }

  resize(cols: number, rows: number): void {
    this.sizes.push([cols, rows]);
  }

  kill(): void {
    this.killed = true;
  }

  /** Claude Code prints something. */
  print(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  /** Claude Code's process ends. */
  exit(exitCode: number): void {
    for (const listener of this.exitListeners) {
      listener({ exitCode });
    }
  }
}
