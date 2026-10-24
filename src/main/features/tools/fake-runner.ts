import type { ProcessRunner, RunResult } from './process-runner';

/** One canned answer, keyed by the command line it answers, such as `gh auth status`. */
export type FakeAnswers = Record<string, RunResult>;

export function exited(exitCode: number, stdout = '', stderr = ''): RunResult {
  return { found: true, exitCode, stdout, stderr };
}

export const NOT_FOUND: RunResult = { found: false };

/**
 * A process runner for tests: answers from a table and records every command line it was asked to run.
 * A command line missing from the table fails the test, so no test can reach a real tool.
 */
export function createFakeRunner(answers: FakeAnswers): ProcessRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(command, args) {
      const line = [command, ...args].join(' ');
      calls.push(line);
      const answer = answers[line];
      if (!answer) {
        throw new Error(`The fake runner has no answer for '${line}'`);
      }
      return answer;
    },
  };
}
