import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../../main/store/memory';
import { DEFAULT_PRD_STRUCTURE } from '../../../main/store/defaults';
import type { Store } from '../../../main/store/store';
import type { GrilloApi } from '../../../shared/ipc';
import { startCreation, type ProjectDraft } from './create';
import { LAST_MEMBERSHIP_KEY, readLastMembership } from './membership';

// Made-up organisations, people and documents only.
const NOW = new Date('2026-10-22T10:00:00.000Z');
const PROJECT = 'example-org/sample-project-1';

function fakeGrillo(settings = new Map<string, unknown>()) {
  const starts: unknown[] = [];
  const grillo = {
    invoke: (async (channel: string, payload: { key: string; value?: unknown; defaultValue?: unknown }) => {
      if (channel === 'settings:get') return settings.has(payload.key) ? settings.get(payload.key) : payload.defaultValue;
      if (channel === 'settings:set') return void settings.set(payload.key, payload.value);
      if (channel === 'agents:start') return `agent-${starts.push(payload)}`;
      throw new Error(`Unexpected channel ${channel}`);
    }) as GrilloApi['invoke'],
    on: () => () => undefined,
  } satisfies GrilloApi;
  return { grillo, starts, settings };
}

const draft = (overrides: Partial<ProjectDraft> = {}): ProjectDraft => ({
  repository: { newRepository: { organisation: 'example-org', name: 'sample-project-1' } },
  projectName: 'Sample project 1',
  structure: DEFAULT_PRD_STRUCTURE,
  invites: [],
  membership: { role: 'Sample role A', domains: ['product'] },
  idea: { kind: 'pasted-text', text: 'Sample idea.' },
  attachments: [],
  ...overrides,
});

describe('creating a project', () => {
  it('saves each attached document as a further source after the idea, and still points the agent at S1', async () => {
    const store = createMemoryStore({ now: () => NOW });
    const { grillo, starts } = fakeGrillo();
    const creation = startCreation(
      { store, grillo, now: () => NOW },
      draft({ attachments: [{ name: 'sample-notes-1.txt', text: 'Sample notes 1.' }, { name: 'sample-notes-2.md', text: 'Sample notes 2.' }] }),
    );

    await creation.run(() => undefined);

    expect((await store.listSources(PROJECT)).map(({ code, kind, where, text }) => ({ code, kind, where, text }))).toEqual([
      { code: 'S1', kind: 'pasted-text', where: 'the idea, given when the project was created', text: 'Sample idea.' },
      { code: 'S2', kind: 'document', where: 'sample-notes-1.txt', text: 'Sample notes 1.' },
      { code: 'S3', kind: 'document', where: 'sample-notes-2.md', text: 'Sample notes 2.' },
    ]);
    expect(creation.steps.map((step) => step.label)).toContain('The attached documents saved as sources S2 and S3');
    expect(starts).toEqual([expect.objectContaining({ firstMessage: '/grillo-wayfinder .grillo/sources/S1.md' })]);
  });

  it.each([
    ['null', null],
    ['no id', {}],
    ['an empty id', { id: '' }],
  ])('stops at the first step when the store answers the new project with %s', async (_case, answer) => {
    const store = { ...createMemoryStore(), createProject: async () => answer } as unknown as Store;
    const { grillo, starts } = fakeGrillo();
    const creation = startCreation({ store, grillo }, draft());

    await creation.run(() => undefined);

    expect(creation.steps[0]).toMatchObject({ state: 'failed', error: 'Grillo could not read the new project from the store.' });
    expect(creation.steps.slice(1).every((step) => step.state === 'waiting')).toBe(true);
    expect(creation.project()).toBeNull();
    expect(starts).toEqual([]);
  });
});

describe('the last membership in the settings file', () => {
  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a list', [{ project: PROJECT, role: 'Sample role A', domains: [] }]],
    ['no project', { role: 'Sample role A', domains: [] }],
    ['domains that are not a list', { project: PROJECT, role: 'Sample role A', domains: 'product' }],
  ])('pre-fills nothing from %s', async (_case, stored) => {
    const settings = new Map<string, unknown>(stored === undefined ? [] : [[LAST_MEMBERSHIP_KEY, stored]]);

    expect(await readLastMembership(fakeGrillo(settings).grillo)).toBeNull();
  });

  it('keeps only the readable domains, each once', async () => {
    const stored = { project: PROJECT, role: 'Sample role A', domains: ['product', null, 3, ' Product ', 'platform', ''] };
    const settings = new Map<string, unknown>([[LAST_MEMBERSHIP_KEY, stored]]);

    expect(await readLastMembership(fakeGrillo(settings).grillo)).toEqual({
      project: PROJECT,
      role: 'Sample role A',
      domains: ['product', 'platform'],
    });
  });
});
