import { describe, expect, it } from 'vitest';
import { createMemorySettings } from './memory/settings';
import { readRecentProjects, RECENT_PROJECTS_KEY, recordRecentProject } from './recent-projects';

describe('recent projects in the settings file', () => {
  it('records each project once, last opened first', () => {
    const settings = createMemorySettings();

    recordRecentProject(settings, 'example-org/one', '2026-10-24T09:00:00.000Z');
    recordRecentProject(settings, 'example-org/two', '2026-10-24T10:00:00.000Z');
    recordRecentProject(settings, 'example-org/one', '2026-10-24T11:00:00.000Z');

    expect(readRecentProjects(settings)).toEqual([
      { project: 'example-org/one', lastOpened: '2026-10-24T11:00:00.000Z' },
      { project: 'example-org/two', lastOpened: '2026-10-24T10:00:00.000Z' },
    ]);
  });

  it.each([
    ['not a list', { project: 'example-org/one' }],
    ['null', null],
    ['a list with null, a number and half entries', [null, 7, { project: 'example-org/one' }, { lastOpened: 'x' }]],
  ])('reads a hand-edited value that is %s as no recent projects', (_case, stored) => {
    const settings = createMemorySettings();
    settings.set(RECENT_PROJECTS_KEY, stored);

    expect(readRecentProjects(settings)).toEqual([]);
  });

  it('keeps the well-formed entries of a list that also holds broken ones', () => {
    const settings = createMemorySettings();
    const good = { project: 'example-org/one', lastOpened: '2026-10-24T09:00:00.000Z' };
    settings.set(RECENT_PROJECTS_KEY, [null, { ...good, extra: true }]);

    expect(readRecentProjects(settings)).toEqual([good]);
  });
});
