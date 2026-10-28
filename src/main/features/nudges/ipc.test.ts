import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGrilloApi } from '../../../preload/bridge';
import { createStoreClient } from '../../../shared/store';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import { createMemorySettings } from '../../store/memory/settings';
import { register as registerStore } from '../store/ipc';
import { register as registerNudges } from './ipc';
import { NUDGE_INTERVAL_MS, NUDGE_TITLE, type Notice } from './nudges';

const shown = vi.hoisted((): Notice[] => []);

vi.mock('electron', () => ({
  app: { isPackaged: false, setAppUserModelId: vi.fn() },
  Notification: class {
    static isSupported = (): boolean => true;
    constructor(private readonly notice: Notice) {}
    show(): void {
      shown.push(this.notice);
    }
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('the nudges feature in the app', () => {
  it('reads the one store the store feature puts on IPC, so one queue guards each project folder', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.stubEnv('GRILLO_STORE', 'memory');
    const fake = createFakeIpc();
    const ipc = createMainIpc(fake.main, () => [fake.window]);
    const settings = createMemorySettings();
    // Main registers features in folder-name order: nudges before store.
    registerNudges({ ipc, settings });
    registerStore({ ipc, settings });

    // Everything below goes through the store feature's IPC, as a screen would.
    const client = createStoreClient(createGrilloApi(fake.renderer));
    const { id } = await client.createProject({ newRepository: { organisation: 'example-org', name: 'shared-store' } });
    await client.createMap(id, { destination: 'A made-up product', notes: '', fog: [], outOfScope: [] });
    const ticket = await client.createTicket(id, {
      title: 'Taken through the screen',
      question: 'Which room?',
      whyItMatters: 'It shapes the demo.',
      assumptions: [],
      kind: 'grilling',
      blockers: [],
      questions: ['First question'],
    });
    await client.claimTicket(ticket.id);
    await client.openProjectFolder(id);
    await vi.advanceTimersByTimeAsync(4 * NUDGE_INTERVAL_MS);

    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: NUDGE_TITLE });
    expect(shown[0].body).toContain('Taken through the screen');
  });
});
