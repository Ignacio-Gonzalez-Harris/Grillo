import { describe, expect, it, vi } from 'vitest';
import { createGrilloApi } from '../../../preload/bridge';
import type { ToolsReport } from '../../../shared/tools';
import { createMainIpc } from '../../ipc/bridge';
import { createFakeIpc } from '../../ipc/fake-ipc';
import { createFakeRunner, exited, type FakeAnswers } from './fake-runner';
import { createIdentityReader, IdentityError } from './identity';
import { registerTools, type ToolsService } from './ipc';

const REPORT: ToolsReport = {
  claude: { installed: true, signedIn: true, version: '2.1.0', guidance: null },
  gh: { installed: true, signedIn: false, version: '2.60.1', guidance: { action: 'sign-in', command: 'gh auth login --web' } },
};

function connect(service: ToolsService) {
  const fake = createFakeIpc();
  registerTools(createMainIpc(fake.main, () => [fake.window]), service);
  return createGrilloApi(fake.renderer);
}

describe('tools IPC channels', () => {
  it('answers tools:check with the report and passes the force flag through', async () => {
    const checkTools = vi.fn(async () => REPORT);
    const grillo = connect({ checkTools, identity: vi.fn() });

    await expect(grillo.invoke('tools:check', { force: true })).resolves.toEqual(REPORT);
    expect(checkTools).toHaveBeenCalledWith({ force: true });
  });

  it('answers tools:identity with the identity, or with the typed reason it could not be read', async () => {
    const identity = { login: 'ada-example', name: 'Ada Example', email: null };
    const signedIn = connect({ checkTools: vi.fn(), identity: async () => identity });
    const signedOut = connect({
      checkTools: vi.fn(),
      identity: async () => {
        throw new IdentityError('signed-out');
      },
    });

    await expect(signedIn.invoke('tools:identity', undefined)).resolves.toEqual({ ok: true, identity });
    await expect(signedOut.invoke('tools:identity', undefined)).resolves.toEqual({ ok: false, reason: 'signed-out' });
  });

  it('reads the email afresh on every tools:identity, so it appears once the member grants gh the email scope', async () => {
    // A made-up member who keeps their email private: until `gh auth refresh -h github.com -s user:email` has run,
    // gh may not read the address list. The fake gh answers by command line, as the real one would.
    const gh: FakeAnswers = {
      'gh api user': exited(0, JSON.stringify({ login: 'ada-example', name: 'Ada Example', email: null })),
      'gh api user/emails': exited(1, '', 'gh: This API operation needs the "user:email" scope. (HTTP 404)\n'),
    };
    const runner = createFakeRunner(gh);
    const grillo = connect({ checkTools: vi.fn(), identity: createIdentityReader(runner).identity });

    const before = await grillo.invoke('tools:identity', undefined);
    gh['gh api user/emails'] = exited(0, JSON.stringify([{ email: 'ada@example.test', primary: true, verified: true }]));
    const after = await grillo.invoke('tools:identity', undefined);

    expect(before).toEqual({ ok: true, identity: { login: 'ada-example', name: 'Ada Example', email: null } });
    expect(after).toEqual({ ok: true, identity: { login: 'ada-example', name: 'Ada Example', email: 'ada@example.test' } });
    expect(runner.calls.filter((line) => line === 'gh api user/emails')).toHaveLength(2);
  });
});
