import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// The release, auto-release and Pages workflows only run on GitHub, so these tests check what they are told to do:
// when they run, on which runners, and in which order the steps come.

interface Step {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  shell?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

interface Job {
  if?: string;
  'runs-on'?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  strategy?: { matrix?: { os?: string[] } };
  steps?: Step[];
  env?: Record<string, unknown>;
  /** A job that calls a reusable workflow has `uses` and `with` instead of steps. */
  uses?: string;
  with?: Record<string, unknown>;
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress': boolean };
  defaults?: { run?: { shell?: string } };
  jobs: Record<string, Job>;
}

interface Inputs {
  inputs: Record<string, { required: boolean; type: string }>;
}

const GATE_COMMANDS = ['npm ci', 'npm run build', 'npm run lint', 'npm run typecheck', 'npm test'];

function workflow(fileName: string): Workflow {
  return parse(readFileSync(join(__dirname, '..', '.github', 'workflows', fileName), 'utf8')) as Workflow;
}

function allSteps(flow: Workflow): Step[] {
  return Object.values(flow.jobs).flatMap((job) => job.steps ?? []);
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

  it('can still be run by hand on a draft tag, and can be called with a tag, a version and the commit to build', () => {
    expect((release.on.workflow_dispatch as Inputs).inputs.tag).toMatchObject({ required: true, type: 'string' });
    const called = (release.on.workflow_call as Inputs).inputs;
    expect(Object.keys(called).sort()).toEqual(['ref', 'tag', 'version']);
    for (const input of Object.values(called)) expect(input).toMatchObject({ required: true, type: 'string' });

    const checkout = allSteps(release).find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with).toMatchObject({ ref: '${{ inputs.ref }}' });
  });

  it('writes a called version into package.json on the runner only, before the tag is checked against it', () => {
    const steps = allSteps(release);
    const setVersion = stepRunning(steps, 'npm version');

    expect(steps[setVersion].if).toBe("inputs.version != ''");
    expect(steps[setVersion].run).toContain('--no-git-tag-version');
    expect(setVersion).toBeLessThan(steps.findIndex((step) => step.name === 'tag matches the version'));
  });
});

describe('auto-release workflow', () => {
  const autoRelease = workflow('auto-release.yml');
  const { decide, draft, installers, publish } = autoRelease.jobs;
  const discard = autoRelease.jobs['discard-draft'];

  const canRelease = [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
  ];

  it('runs only after CI succeeded on a push to main, one run at a time and never cancelled half-way', () => {
    expect(autoRelease.on).toEqual({ workflow_run: { workflows: ['ci'], types: ['completed'], branches: ['main'] } });
    for (const condition of canRelease) expect(decide.if).toContain(condition);
    expect(autoRelease.concurrency?.['cancel-in-progress']).toBe(false);
  });

  it('queues only runs that can release: any other run gets a group of its own and never replaces a waiting one', () => {
    const group = autoRelease.concurrency?.group ?? '';

    expect(group).toMatch(/^\$\{\{ .* \}\}$/s);
    for (const condition of canRelease) expect(group).toContain(condition);
    expect(group).toContain("&& 'auto-release' || format('auto-release-skipped-{0}', github.run_id)");
  });

  it('runs every step under an explicit bash, so a failing command in a pipe fails the step', () => {
    expect(autoRelease.defaults).toEqual({ run: { shell: 'bash' } });
    for (const step of allSteps(autoRelease)) expect(step.shell).toBeUndefined();
  });

  it('lets the release script decide on the commit CI passed, and drafts only when it says release', () => {
    expect(stepRunning(decide.steps ?? [], 'node scripts/release/next-release.mts')).toBeGreaterThanOrEqual(0);
    const checkout = decide.steps?.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with).toMatchObject({ ref: '${{ github.event.workflow_run.head_sha }}', 'fetch-depth': 0 });

    expect(draft.if).toBe("needs.decide.outputs.release == 'true'");
    const create = draft.steps?.[stepRunning(draft.steps, 'gh release create')].run ?? '';
    for (const flag of ['--draft', '--target "$HEAD_SHA"', '--generate-notes']) expect(create).toContain(flag);
  });

  it('builds both installers with release.yml, then publishes the draft only once that build is green', () => {
    expect(installers.uses).toBe('./.github/workflows/release.yml');
    expect(installers.needs).toEqual(['decide', 'draft']);
    expect(installers.with).toEqual({
      tag: '${{ needs.decide.outputs.tag }}',
      version: '${{ needs.decide.outputs.version }}',
      ref: '${{ github.event.workflow_run.head_sha }}',
    });

    expect(publish.needs).toContain('installers');
    expect(publish.if).toBeUndefined();
    expect(stepRunning(publish.steps ?? [], 'gh release edit "$RELEASE_TAG" --draft=false')).toBeGreaterThanOrEqual(0);
  });

  it('deletes the draft and stays red when the build or the publish did not succeed', () => {
    expect(discard.needs).toEqual(['decide', 'draft', 'installers', 'publish']);
    for (const condition of [
      'always()',
      "needs.draft.result == 'success'",
      "needs.installers.result != 'success' || needs.publish.result != 'success'",
    ]) {
      expect(discard.if).toContain(condition);
    }
    const remove = discard.steps?.[stepRunning(discard.steps, 'gh release delete')].run ?? '';
    expect(remove).toContain('isDraft');
    expect(remove.trimEnd().endsWith('exit 1')).toBe(true);
  });

  it('holds a write token only in the jobs that change the release', () => {
    expect(autoRelease.permissions).toEqual({ contents: 'read' });
    expect(decide.permissions).toBeUndefined();
    for (const job of [draft, installers, publish, discard]) expect(job.permissions).toEqual({ contents: 'write' });
  });
});

describe('every workflow', () => {
  const workflows = ['ci.yml', 'release.yml', 'auto-release.yml', 'pages.yml'];

  it.each(workflows)('%s never pushes to the repository', (fileName) => {
    for (const step of allSteps(workflow(fileName))) {
      expect(step.run ?? '').not.toMatch(/git (push|commit|tag)\b/);
    }
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

  it('publishes the page and every file it loads from beside itself, the logo included', () => {
    const page = readFileSync(join(__dirname, '..', 'site', 'index.html'), 'utf8');
    const references = [...page.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    const localFiles = references.filter((reference) => !/^(?:[a-z]+:|#|\/\/)/i.test(reference));
    const steps = allSteps(pages);
    const collect = steps[stepRunning(steps, 'site/')]?.run ?? '';

    expect(localFiles).toContain('grillo-logo.png');
    for (const file of ['index.html', ...localFiles]) expect(collect).toContain(`site/${file}`);
  });

  it('skips the deploy until Pages is switched on with the PAGES_ENABLED repository variable', () => {
    for (const job of Object.values(pages.jobs)) {
      expect(job.if).toBe("${{ vars.PAGES_ENABLED == 'true' }}");
    }
  });
});

describe('workflows that hold a write token', () => {
  it.each(['release.yml', 'auto-release.yml', 'pages.yml'])(
    '%s checks out without leaving the token in .git/config for dependency scripts to read',
    (fileName) => {
      const checkouts = allSteps(workflow(fileName)).filter((step) => step.uses?.startsWith('actions/checkout@'));

      expect(checkouts.length).toBeGreaterThan(0);
      for (const checkout of checkouts) {
        expect(checkout.with).toMatchObject({ 'persist-credentials': false });
      }
    },
  );
});

describe('CI gate', () => {
  it('never builds installers (only a release does)', () => {
    for (const step of allSteps(workflow('ci.yml'))) {
      expect(step.run ?? '').not.toMatch(/npm run dist|electron-builder/);
    }
  });
});

describe("Electron's binary", () => {
  it.each(['ci.yml', 'release.yml'])(
    '%s downloads it once, before the tests: test files starting Electron in parallel raced its first download',
    (fileName) => {
      const steps = allSteps(workflow(fileName));
      const download = stepRunning(steps, 'install-electron');

      expect(download).toBeGreaterThan(stepRunning(steps, 'npm ci'));
      expect(download).toBeLessThan(stepRunning(steps, 'npm test'));
    },
  );
});

describe('universal Mac build', () => {
  it('adds the speech engine for both Mac chips, checked against the lockfile, before the installers are built', () => {
    const steps = allSteps(workflow('release.yml'));
    const engines = steps.findIndex((step) => step.run?.includes('node-whisper-darwin-'));

    expect(engines).toBeGreaterThan(stepRunning(steps, 'npm ci'));
    expect(engines).toBeLessThan(stepRunning(steps, 'npm run dist'));
    expect(steps[engines].if).toBe("runner.os == 'macOS'");
    expect(steps[engines].run).toContain('integrity');
  });
});
