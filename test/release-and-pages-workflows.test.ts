import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// The release and Pages workflows only run on GitHub, so these tests check what they are told to do: when they run,
// on which runners, and in which order the steps come.

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

interface Job {
  if?: string;
  'runs-on': string;
  strategy?: { matrix?: { os?: string[] } };
  steps: Step[];
  env?: Record<string, unknown>;
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const GATE_COMMANDS = ['npm ci', 'npm run build', 'npm run lint', 'npm run typecheck', 'npm test'];

function workflow(fileName: string): Workflow {
  return parse(readFileSync(join(__dirname, '..', '.github', 'workflows', fileName), 'utf8')) as Workflow;
}

function allSteps(flow: Workflow): Step[] {
  return Object.values(flow.jobs).flatMap((job) => job.steps);
}

/** Index of the first step whose `run` script contains the command, or -1. */
function stepRunning(steps: Step[], command: string): number {
  return steps.findIndex((step) => step.run?.includes(command));
}

describe('release workflow', () => {
  const release = workflow('release.yml');

  it('runs when a release is published, on a Windows and a Mac runner', () => {
    expect(release.on.release).toEqual({ types: ['published'] });
    const jobs = Object.values(release.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].strategy?.matrix?.os).toEqual(['windows-latest', 'macos-latest']);
    expect(jobs[0]['runs-on']).toBe('${{ matrix.os }}');
  });

  it('runs the gate, then builds the installers, then uploads them and the update files to the release', () => {
    const steps = allSteps(release);
    const order = [...GATE_COMMANDS, 'npm run dist', 'gh release upload'].map((command) => stepRunning(steps, command));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const upload = steps[stepRunning(steps, 'gh release upload')].run ?? '';
    expect(upload).toContain('latest');
    expect(release.permissions).toEqual({ contents: 'write' });
  });

  it('builds unsigned installers: no signing secret reaches the build', () => {
    const text = readFileSync(join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
    for (const signingVariable of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'APPLE_ID', 'APPLE_TEAM_ID']) {
      expect(text).not.toContain(signingVariable);
    }
    const dist = allSteps(release)[stepRunning(allSteps(release), 'npm run dist')];
    expect(dist.env).toMatchObject({ CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  });
});

describe('Pages workflow', () => {
  const pages = workflow('pages.yml');

  it('publishes the site folder from main on every push', () => {
    expect(pages.on.push).toEqual({ branches: ['main'] });
    const steps = allSteps(pages);
    const upload = steps.find((step) => step.uses?.startsWith('actions/upload-pages-artifact@'));
    const deploy = steps.find((step) => step.uses?.startsWith('actions/deploy-pages@'));

    expect(upload).toBeDefined();
    expect(deploy).toBeDefined();
    expect(stepRunning(steps, 'site/')).toBeGreaterThanOrEqual(0);
    expect(pages.permissions).toMatchObject({ pages: 'write', 'id-token': 'write' });
  });

  it('skips the deploy until Pages is switched on with the PAGES_ENABLED repository variable', () => {
    for (const job of Object.values(pages.jobs)) {
      expect(job.if).toBe("${{ vars.PAGES_ENABLED == 'true' }}");
    }
  });
});

describe('CI gate', () => {
  it('never builds installers (only a published release does)', () => {
    for (const step of allSteps(workflow('ci.yml'))) {
      expect(step.run ?? '').not.toMatch(/npm run dist|electron-builder/);
    }
  });
});
