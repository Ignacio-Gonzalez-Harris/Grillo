import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStore, type MemoryStore } from '../../store/memory';
import { createMemorySettings } from '../../store/memory/settings';
import { StoreError } from '../../store/store';
import type { Ticket } from '../../store/types';
import {
  createNudgesFeature,
  DEFAULT_NUDGE_AFTER_DAYS,
  NUDGE_AFTER_DAYS_SETTING,
  NUDGE_HELD_SINCE_SETTING,
  NUDGE_INTERVAL_MS,
  type Notice,
  type NudgeStore,
} from './nudges';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-10-20T09:00:00.000Z');
const OTHER_MEMBER = 'ben-example';

function clock() {
  let current = START;
  return { now: () => new Date(current), advance: (ms: number) => (current += ms) };
}

const quietLog = { warn: vi.fn() };

/** A project opened on this laptop, with Ben as a second member, so tickets can be sent to him. */
async function projectIn(store: MemoryStore, name: string): Promise<string> {
  const { id } = await store.createProject({ newRepository: { organisation: 'example-org', name } });
  await store.createMap(id, { destination: 'A made-up product', notes: '', fog: [], outOfScope: [] });
  await store.addMember(id, { login: OTHER_MEMBER, role: 'product', domains: [] });
  await store.openProjectFolder(id);
  return id;
}

async function ticketIn(store: MemoryStore, project: string, title: string): Promise<Ticket> {
  return store.createTicket(project, {
    title,
    question: `${title}?`,
    whyItMatters: 'It shapes the demo.',
    assumptions: [],
    kind: 'grilling',
    blockers: [],
    questions: ['First question'],
  });
}

async function answer(store: MemoryStore, ticket: Ticket): Promise<void> {
  await store.createAnswer(ticket.id, {
    question: ticket.questions[0].code,
    text: 'A made-up answer',
    fromComment: null,
    sources: [],
    via: null,
  });
}

function setup(storeFor: (store: MemoryStore) => NudgeStore = (store) => store) {
  const { now, advance } = clock();
  const settings = createMemorySettings();
  const store = createMemoryStore({ now, settings });
  const notices: Notice[] = [];
  const nudges = createNudgesFeature({
    store: storeFor(store),
    settings,
    notifier: { show: (notice) => notices.push(notice) },
    now,
    log: quietLog,
  });
  return { store, settings, notices, nudges, advance };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('nudges on tickets taken but silent for days', () => {
  it('raises one notification naming only my open claimed tickets with no answer for 3 days', async () => {
    const { store, notices, nudges, advance } = setup();
    const project = await projectIn(store, 'nudge-demo');
    const silent = await ticketIn(store, project, 'Silent ticket');
    const answeredLater = await ticketIn(store, project, 'Answered later');
    const sentToBen = await ticketIn(store, project, 'Sent to Ben');
    await ticketIn(store, project, 'In the pool');
    const closed = await ticketIn(store, project, 'Closed ticket');
    await store.claimTicket(silent.id);
    await store.claimTicket(answeredLater.id);
    await store.sendTicket(sentToBen.id, OTHER_MEMBER);
    await store.claimTicket(closed.id);
    await store.closeTicket(closed.id);

    await nudges.check();
    expect(notices).toEqual([]);

    advance(2 * DAY_MS);
    await answer(store, answeredLater);
    advance(DAY_MS);
    await nudges.check();

    expect(DEFAULT_NUDGE_AFTER_DAYS).toBe(3);
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain('Silent ticket');
    for (const title of ['Answered later', 'Sent to Ben', 'In the pool', 'Closed ticket']) {
      expect(notices[0].body).not.toContain(title);
    }
  });

  it('names the tickets of every recent project in the one notification, archived projects left out', async () => {
    const { store, notices, nudges, advance } = setup();
    for (const name of ['first-project', 'second-project', 'archived-project']) {
      const project = await projectIn(store, name);
      await store.claimTicket((await ticketIn(store, project, `Ticket of ${name}`)).id);
    }
    await store.archiveProject('example-org/archived-project');

    await nudges.check();
    advance(3 * DAY_MS);
    await nudges.check();

    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain('Ticket of first-project');
    expect(notices[0].body).toContain('Ticket of second-project');
    expect(notices[0].body).not.toContain('Ticket of archived-project');
  });

  it('waits the number of days the setting gives, and the default when the setting is unusable', async () => {
    const days = [
      [1, 1],
      [0, DEFAULT_NUDGE_AFTER_DAYS],
      [-2, DEFAULT_NUDGE_AFTER_DAYS],
      ['1', DEFAULT_NUDGE_AFTER_DAYS],
      [null, DEFAULT_NUDGE_AFTER_DAYS],
      [Number.NaN, DEFAULT_NUDGE_AFTER_DAYS],
    ] as const;
    for (const [setting, waited] of days) {
      const { store, settings, notices, nudges, advance } = setup();
      settings.set(NUDGE_AFTER_DAYS_SETTING, setting);
      const project = await projectIn(store, 'nudge-demo');
      await store.claimTicket((await ticketIn(store, project, 'Silent ticket')).id);

      await nudges.check();
      advance(waited * DAY_MS - 1);
      await nudges.check();
      expect(notices, `setting ${String(setting)}`).toEqual([]);
      advance(1);
      await nudges.check();
      expect(notices, `setting ${String(setting)}`).toHaveLength(1);
    }
  });

  it('counts the days afresh when a ticket is released and taken again', async () => {
    const { store, notices, nudges, advance } = setup();
    const project = await projectIn(store, 'nudge-demo');
    const ticket = await ticketIn(store, project, 'Taken twice');
    await store.claimTicket(ticket.id);
    await nudges.check();

    advance(2 * DAY_MS);
    await store.releaseTicket(ticket.id);
    await nudges.check();
    await store.claimTicket(ticket.id);
    await nudges.check();
    advance(2 * DAY_MS);
    await nudges.check();

    expect(notices).toEqual([]);
  });

  it('still nudges about the other projects when one project cannot be read, and ignores unreadable answer dates', async () => {
    const { store, notices, nudges, advance } = setup((memory) => ({
      ...memory,
      getProject: async (project) => {
        if (project === 'example-org/unreachable') {
          throw new StoreError('conflict', 'The project folder could not be brought up to date with GitHub');
        }
        return memory.getProject(project);
      },
      listTickets: async (project, filter) => {
        if (project === 'example-org/broken') {
          throw new StoreError('backend', 'gh failed');
        }
        return memory.listTickets(project, filter);
      },
      listAnswers: async (id) => (await memory.listAnswers(id)).map((entry) => ({ ...entry, when: 'not a date' })),
    }));
    await projectIn(store, 'unreachable');
    await projectIn(store, 'broken');
    const project = await projectIn(store, 'nudge-demo');
    const ticket = await ticketIn(store, project, 'Silent ticket');
    await store.claimTicket(ticket.id);
    await nudges.check();
    advance(3 * DAY_MS);
    await answer(store, ticket);

    await nudges.check();

    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain('Silent ticket');
    expect(quietLog.warn).toHaveBeenCalledWith(expect.stringContaining('example-org/unreachable'));
    expect(quietLog.warn).toHaveBeenCalledWith(expect.stringContaining('example-org/broken'));
  });

  it('keeps counting through a check that could not read the project, and restarts a count whose note is unreadable', async () => {
    let unreadable = false;
    const { store, settings, notices, nudges, advance } = setup((memory) => ({
      ...memory,
      listTickets: async (project, filter) => {
        if (unreadable) {
          throw new StoreError('backend', 'gh failed');
        }
        return memory.listTickets(project, filter);
      },
    }));
    const project = await projectIn(store, 'nudge-demo');
    const kept = await ticketIn(store, project, 'Kept count');
    const corrupt = await ticketIn(store, project, 'Corrupt note');
    await store.claimTicket(kept.id);
    await store.claimTicket(corrupt.id);
    await nudges.check();

    advance(2 * DAY_MS);
    unreadable = true;
    await nudges.check();
    unreadable = false;
    const notes = settings.get<Record<string, string>>(NUDGE_HELD_SINCE_SETTING, {});
    const corruptKey = Object.keys(notes).find((key) => key.endsWith(`#${corrupt.id.number}`)) ?? '';
    settings.set(NUDGE_HELD_SINCE_SETTING, { ...notes, [corruptKey]: 'not a date' });
    advance(DAY_MS);
    await nudges.check();

    expect(notices).toHaveLength(1);
    expect(notices[0].body).toContain('Kept count');
    expect(notices[0].body).not.toContain('Corrupt note');
  });

  it('checks when Grillo opens and again every day', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let checks = 0;
    const { store, notices, nudges, advance } = setup((memory) => ({
      ...memory,
      listRecentProjects: () => {
        checks++;
        return memory.listRecentProjects();
      },
    }));
    const project = await projectIn(store, 'nudge-demo');
    await store.claimTicket((await ticketIn(store, project, 'Silent ticket')).id);

    nudges.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(checks).toBe(1);
    for (let day = 1; day <= 3; day++) {
      advance(DAY_MS);
      await vi.advanceTimersByTimeAsync(NUDGE_INTERVAL_MS);
    }
    nudges.stop();
    await vi.advanceTimersByTimeAsync(NUDGE_INTERVAL_MS);

    expect(checks).toBe(4);
    expect(notices).toHaveLength(1);
  });
});
