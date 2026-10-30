import type { ChatProcess, ChatSpawnOptions } from './driver';

/** A stand-in for the `claude` process, for tests: records what was written and lets the test play Claude Code. */
export class FakeChatProcess implements ChatProcess {
  readonly written: string[] = [];
  stopped = false;
  private readonly stdoutListeners: Array<(chunk: string) => void> = [];
  private readonly stderrListeners: Array<(chunk: string) => void> = [];
  private readonly exitListeners: Array<(exitCode: number | null) => void> = [];

  constructor(
    readonly file: string,
    readonly args: readonly string[],
    readonly options: ChatSpawnOptions,
  ) {}

  onStdout(listener: (chunk: string) => void): void {
    this.stdoutListeners.push(listener);
  }

  onStderr(listener: (chunk: string) => void): void {
    this.stderrListeners.push(listener);
  }

  onExit(listener: (exitCode: number | null) => void): void {
    this.exitListeners.push(listener);
  }

  write(data: string): void {
    this.written.push(data);
  }

  stop(): void {
    this.stopped = true;
  }

  /** Every JSON line written to stdin, parsed. */
  get writtenEvents(): unknown[] {
    return this.written
      .join('')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as unknown);
  }

  /** Claude Code prints a raw chunk of stdout (not necessarily whole lines). */
  print(chunk: string): void {
    for (const listener of this.stdoutListeners) {
      listener(chunk);
    }
  }

  /** Claude Code prints whole event lines. */
  emit(...lines: string[]): void {
    this.print(lines.map((line) => `${line}\n`).join(''));
  }

  /** Claude Code prints a raw chunk of its error text (stderr). */
  printError(chunk: string): void {
    for (const listener of this.stderrListeners) {
      listener(chunk);
    }
  }

  exit(exitCode: number | null): void {
    for (const listener of this.exitListeners) {
      listener(exitCode);
    }
  }
}
