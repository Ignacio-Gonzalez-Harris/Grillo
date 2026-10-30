// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { EventChannel, EventPayload, GrilloApi } from '../../../shared/ipc';
import type { IdentityResult, ToolStatus, ToolsReport } from '../../../shared/tools';
import type { UpdateState } from '../../../shared/updates';
import { START_SCREEN } from '../../app/navigation';
import { registerScreens, type ShellContext } from '../../app/screens';
import * as setupCheck from './index';
import { RELEASE_PAGE_URL } from './update-card';

// Made-up tool results, as the tools feature reports them.
const CLAUDE_URL = 'https://example.com/install-claude';
const GH_URL = 'https://example.com/install-gh';
const ready: ToolStatus = { installed: true, signedIn: true, version: '1.0.0', guidance: null };
const missing = (url: string): ToolStatus => ({
  installed: false,
  signedIn: false,
  version: null,
  guidance: { action: 'install', url },
});
const signedOut = (command: string): ToolStatus => ({
  installed: true,
  signedIn: false,
  version: '2.0.0',
  guidance: { action: 'sign-in', command },
});

const ALL_GREEN: ToolsReport = { claude: ready, gh: ready };
const EVERYTHING_MISSING: ToolsReport = { claude: missing(CLAUDE_URL), gh: missing(GH_URL) };
const GH_SIGNED_OUT: ToolsReport = { claude: ready, gh: signedOut('gh auth login --web') };

const MEMBER: IdentityResult = {
  ok: true,
  identity: { login: 'member-a', name: 'Ana Example', email: 'member-a@example.com' },
};

const NO_UPDATE: UpdateState = {
  currentVersion: '1.0.0',
  phase: 'none',
  version: null,
  percent: null,
  autoUpdate: false,
  manualInstall: false,
};
const OFFER: UpdateState = { ...NO_UPDATE, phase: 'available', version: '1.1.0' };

type Handler = (payload: unknown) => unknown;

/** A stand-in for `window.grillo`: each channel answers from `handlers`; `emit` plays an event from main. */
function fakeGrillo(overrides: Record<string, Handler> = {}) {
  const handlers: Record<string, Handler> = {
    'tools:check': () => ALL_GREEN,
    'tools:identity': () => MEMBER,
    'updates:get-state': () => NO_UPDATE,
    'updates:set-auto-update': (enabled) => ({ ...NO_UPDATE, autoUpdate: enabled }),
    'updates:install': () => undefined,
    'updates:later': () => undefined,
    'transcription:get-model-updates': () => 'ask',
    'transcription:set-model-updates': () => undefined,
    ...overrides,
  };
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const invoke = vi.fn(async (channel: string, payload: unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`No fake for ${channel}`);
    return handler(payload);
  });
  const grillo = {
    invoke,
    on: vi.fn((channel: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => set.delete(listener);
    }),
  } as unknown as GrilloApi;
  function emit<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
    listeners.get(channel)?.forEach((listener) => listener(payload));
  }
  const calls = (channel: string) => invoke.mock.calls.filter(([name]) => name === channel).map(([, payload]) => payload);
  const listenerCount = () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
  return { grillo, emit, calls, listenerCount };
}

/** A promise the test settles by hand, for answers that must stay pending. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

let unmount: (() => void) | undefined;
let navigate: Mock<ShellContext['navigate']>;

async function open(grillo: GrilloApi): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.append(el);
  navigate = vi.fn<ShellContext['navigate']>();
  const shell: ShellContext = { grillo, navigate, agentTabHeader: () => undefined, onAgentTabs: () => () => undefined };
  unmount = setupCheck.mount(el, {}, shell) ?? undefined;
  await flush();
  return el;
}

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.requirements > li')];
const rowNamed = (el: HTMLElement, name: string) => rows(el).find((row) => row.querySelector('.strong')?.textContent === name);
const badges = (row: Element | undefined) => [...(row?.querySelectorAll('.badge') ?? [])].map((b) => b.textContent);
const buttonNamed = (el: Element, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
const continueButton = (el: HTMLElement) => buttonNamed(el, 'Continue');
const card = (el: HTMLElement) => el.querySelector<HTMLElement>('.update-card');
const pressedModes = (el: HTMLElement) =>
  [...(card(el)?.querySelectorAll('.seg button[aria-pressed="true"]') ?? [])].map((b) => b.textContent);

const CLAUDE = 'Claude Code';
const GH = 'GitHub command-line tool (gh)';
const ACCOUNT = 'GitHub account';

let openWindow: ReturnType<typeof vi.fn>;
beforeEach(() => {
  openWindow = vi.fn();
  vi.stubGlobal('open', openWindow);
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('setup check screen: registration', () => {
  it('registers itself from its own folder as the screen the shell opens first', () => {
    const registry = registerScreens({ '/src/renderer/screens/setup-check/index.ts': setupCheck });

    expect(registry.get(START_SCREEN)?.title).toBe('Setup check');
  });
});

describe('setup check screen: the requirement rows', () => {
  it('shows every row as checking, Continue locked and no update card, while the tools are being checked', async () => {
    const pending = deferred<ToolsReport>();
    const el = await open(fakeGrillo({ 'tools:check': () => pending.promise }).grillo);

    expect(rows(el).map((row) => badges(row))).toEqual([['Checking…'], ['Checking…'], ['Checking…']]);
    expect(continueButton(el)?.disabled).toBe(true);
    expect(buttonNamed(el, 'Check again')).toBeUndefined();
    expect(el.querySelector('.reason')).toBeNull();
    expect(card(el)).toBeNull();
  });

  it('shows the install steps and opens each install guide when both tools are missing, without asking for the identity', async () => {
    const fake = fakeGrillo({ 'tools:check': () => EVERYTHING_MISSING });
    const el = await open(fake.grillo);

    expect(el.querySelector('.note.err')?.textContent).toContain('Grillo needs two tools on this laptop');
    expect(badges(rowNamed(el, CLAUDE))).toEqual(['Not found']);
    expect(badges(rowNamed(el, GH))).toEqual(['Not found']);
    expect(rowNamed(el, CLAUDE)?.textContent).toContain('Install Claude Code.');
    expect(badges(rowNamed(el, ACCOUNT))).toEqual(['Waits for gh']);
    buttonNamed(rowNamed(el, CLAUDE)!, 'Open install guide')?.click();
    buttonNamed(rowNamed(el, GH)!, 'Open install guide')?.click();
    expect(openWindow.mock.calls.map(([url]) => url)).toEqual([CLAUDE_URL, GH_URL]);
    expect(continueButton(el)?.disabled).toBe(true);
    expect(el.querySelector('.reason')?.textContent).toBe('Continue unlocks when every row is green.');
    expect(fake.calls('tools:identity')).toEqual([]);
  });

  it('shows the sign-in command the tools feature gives when signed out of GitHub', async () => {
    const el = await open(fakeGrillo({ 'tools:check': () => GH_SIGNED_OUT }).grillo);

    expect(badges(rowNamed(el, CLAUDE))).toEqual(['Installed', 'Signed in']);
    expect(badges(rowNamed(el, GH))).toEqual(['Installed', 'Signed out']);
    expect(rowNamed(el, GH)?.querySelector('code')?.textContent).toBe('gh auth login --web');
    expect(badges(rowNamed(el, ACCOUNT))).toEqual(['Not signed in']);
    expect(buttonNamed(el, 'Check again')).toBeDefined();
    expect(continueButton(el)?.disabled).toBe(true);
  });

  it('shows the sign-in command for a signed-out Claude Code too', async () => {
    const report: ToolsReport = { claude: signedOut('claude auth login'), gh: ready };
    const el = await open(fakeGrillo({ 'tools:check': () => report }).grillo);

    expect(badges(rowNamed(el, CLAUDE))).toEqual(['Installed', 'Signed out']);
    expect(rowNamed(el, CLAUDE)?.querySelector('code')?.textContent).toBe('claude auth login');
  });

  it('shows the login, name and email when all is green, and Continue opens the project screen', async () => {
    const el = await open(fakeGrillo().grillo);

    const account = rowNamed(el, ACCOUNT);
    expect(badges(account)).toEqual(['Signed in']);
    expect([...(account?.querySelectorAll('tr') ?? [])].map((tr) => tr.textContent)).toEqual([
      'Loginmember-a',
      'NameAna Example',
      'Emailmember-a@example.com',
    ]);
    expect(buttonNamed(el, 'Check again')).toBeUndefined();
    continueButton(el)?.click();
    expect(navigate).toHaveBeenCalledWith('project-creation');
  });

  it('shows the one-time email step with Check again when GitHub shares no email, and says when no name is set', async () => {
    const noEmail: IdentityResult = { ok: true, identity: { login: 'member-b', name: null, email: null } };
    const el = await open(fakeGrillo({ 'tools:identity': () => noEmail }).grillo);

    const account = rowNamed(el, ACCOUNT);
    expect(account?.textContent).toContain('NameNot set on GitHub');
    expect(account?.textContent).toContain('EmailNot shared yet');
    expect(account?.querySelector('code')?.textContent).toBe('gh auth refresh -h github.com -s user:email');
    expect(account?.textContent).toContain('approve it in your browser, then press Check again.');
    expect(buttonNamed(el, 'Check again')).toBeDefined();
    expect(continueButton(el)?.disabled).toBe(false);
  });

  it('reads the email again on "Check again" once the email step has run, and drops the step', async () => {
    const noEmail: IdentityResult = { ok: true, identity: { login: 'member-b', name: null, email: null } };
    const withEmail: IdentityResult = { ok: true, identity: { ...noEmail.identity, email: 'member-b@example.com' } };
    const answers = [noEmail, withEmail];
    const fake = fakeGrillo({ 'tools:identity': () => answers.shift() });
    const el = await open(fake.grillo);

    buttonNamed(el, 'Check again')?.click();
    await flush();

    const account = rowNamed(el, ACCOUNT);
    expect(fake.calls('tools:identity')).toHaveLength(2);
    expect(account?.textContent).toContain('Emailmember-b@example.com');
    expect(account?.querySelector('code')).toBeNull();
    expect(buttonNamed(el, 'Check again')).toBeUndefined();
  });

  it('"Check again" forces a fresh check and shows its answer', async () => {
    const answers = [GH_SIGNED_OUT, ALL_GREEN];
    const fake = fakeGrillo({ 'tools:check': () => answers.shift() });
    const el = await open(fake.grillo);

    buttonNamed(el, 'Check again')?.click();
    expect(badges(rowNamed(el, CLAUDE))).toEqual(['Checking…']);
    await flush();

    expect(fake.calls('tools:check')).toEqual([{ force: false }, { force: true }]);
    expect(badges(rowNamed(el, ACCOUNT))).toEqual(['Signed in']);
    expect(continueButton(el)?.disabled).toBe(false);
  });

  it.each<[string, Handler]>([
    ['a refused check', () => Promise.reject(new Error('boom'))],
    ['no answer', () => null],
    ['a report missing gh', () => ({ claude: ready })],
    ['a null tool', () => ({ claude: ready, gh: null })],
    ['a missing tool with no install guidance', () => ({ claude: { ...missing(CLAUDE_URL), guidance: null }, gh: ready })],
    ['a signed-out tool with an empty command', () => ({ claude: ready, gh: signedOut('') })],
    ['an install guide that is not a web address', () => ({ claude: missing('file:///c:/sample'), gh: ready })],
    ['an unknown guidance action', () => ({ claude: { ...ready, signedIn: false, guidance: { action: 'pray' } }, gh: ready })],
    ['a status flag that is not a boolean', () => ({ claude: { ...ready, installed: 'yes' }, gh: ready })],
  ])('shows the check as failed, with Check again, for %s', async (_case, check) => {
    const el = await open(fakeGrillo({ 'tools:check': check }).grillo);

    expect(el.querySelector('.note.err')?.textContent).toContain('Grillo could not check the tools');
    expect(rows(el).map((row) => badges(row))).toEqual([['Not checked'], ['Not checked'], ['Not checked']]);
    expect(buttonNamed(el, 'Check again')).toBeDefined();
    expect(continueButton(el)?.disabled).toBe(true);
  });

  it.each<[string, Handler]>([
    ['a refused identity call', () => Promise.reject(new Error('boom'))],
    ['no answer', () => null],
    ['ok with no identity', () => ({ ok: true })],
    ['ok with a null identity', () => ({ ok: true, identity: null })],
    ['ok with an empty login', () => ({ ok: true, identity: { login: '', name: null, email: null } })],
    ['a failure reason', () => ({ ok: false, reason: 'failed' })],
    ['an unknown failure reason', () => ({ ok: false, reason: 'gremlins' })],
  ])('says the GitHub account could not be read for %s', async (_case, identity) => {
    const el = await open(fakeGrillo({ 'tools:identity': identity }).grillo);

    expect(badges(rowNamed(el, ACCOUNT))).toEqual(['Could not read']);
    expect(buttonNamed(el, 'Check again')).toBeDefined();
    expect(continueButton(el)?.disabled).toBe(true);
  });

  it('shows the account as not signed in when gh signs out between the two calls', async () => {
    const el = await open(fakeGrillo({ 'tools:identity': () => ({ ok: false, reason: 'signed-out' }) }).grillo);

    expect(badges(rowNamed(el, ACCOUNT))).toEqual(['Not signed in']);
  });
});

describe('setup check screen: the update card', () => {
  it('offers the update with Download and install, and Later hides the offer', async () => {
    const fake = fakeGrillo({ 'updates:get-state': () => OFFER });
    const el = await open(fake.grillo);

    expect(card(el)?.getAttribute('aria-label')).toBe('Update offer');
    expect(card(el)?.textContent).toContain('Grillo 1.1.0 is available. You have 1.0.0.');
    buttonNamed(card(el)!, 'Download and install')?.click();
    await flush();
    expect(fake.calls('updates:install')).toHaveLength(1);

    buttonNamed(card(el)!, 'Later')?.click();
    await flush();
    expect(fake.calls('updates:later')).toHaveLength(1);
    expect(card(el)?.textContent).not.toContain('1.1.0');
    expect(buttonNamed(card(el)!, 'Download and install')).toBeUndefined();
  });

  it('follows the update events: offered, downloading with its progress, then ready to install', async () => {
    const fake = fakeGrillo();
    const el = await open(fake.grillo);
    expect(buttonNamed(card(el)!, 'Download and install')).toBeUndefined();

    fake.emit('updates:update-available', { version: '1.2.0' });
    expect(card(el)?.textContent).toContain('Grillo 1.2.0 is available. You have 1.0.0.');

    fake.emit('updates:download-progress', { version: '1.2.0', percent: 41.6 });
    expect(card(el)?.textContent).toContain('Downloading Grillo 1.2.0: 42%');
    expect(buttonNamed(card(el)!, 'Download and install')?.disabled).toBe(true);

    fake.emit('updates:ready-to-install', { version: '1.2.0' });
    expect(card(el)?.textContent).toContain('Grillo 1.2.0 is downloaded.');
    buttonNamed(card(el)!, 'Restart and install')?.click();
    await flush();
    expect(fake.calls('updates:install')).toHaveLength(1);
  });

  it('ignores update events it cannot use', async () => {
    const fake = fakeGrillo({ 'updates:get-state': () => OFFER });
    const el = await open(fake.grillo);
    const before = card(el)?.textContent;

    fake.emit('updates:update-available', null as never);
    fake.emit('updates:update-available', { version: '' });
    fake.emit('updates:download-progress', { version: '1.1.0', percent: Number.NaN });
    fake.emit('updates:download-progress', { version: null as never, percent: 10 });
    fake.emit('updates:ready-to-install', {} as never);

    expect(card(el)?.textContent).toBe(before);
  });

  it('opens the release page instead of installing on a Mac that cannot install updates itself', async () => {
    const fake = fakeGrillo({ 'updates:get-state': () => ({ ...OFFER, manualInstall: true }) });
    const el = await open(fake.grillo);

    expect(card(el)?.textContent).toContain('drag it into Applications');
    buttonNamed(card(el)!, 'Download and install')?.click();
    await flush();

    expect(openWindow).toHaveBeenCalledWith(RELEASE_PAGE_URL);
    expect(fake.calls('updates:install')).toEqual([]);
  });

  it('shows the app updates switch as saved and saves a change through the updates feature', async () => {
    const fake = fakeGrillo();
    const el = await open(fake.grillo);
    const autoUpdate = card(el)?.querySelector<HTMLInputElement>('.switch input');

    expect(autoUpdate?.checked).toBe(false);
    autoUpdate?.click();
    await flush();

    expect(fake.calls('updates:set-auto-update')).toEqual([true]);
    expect(card(el)?.querySelector<HTMLInputElement>('.switch input')?.checked).toBe(true);
  });

  it('puts the app updates switch back when saving it fails', async () => {
    const fake = fakeGrillo({ 'updates:set-auto-update': () => Promise.reject(new Error('disk full')) });
    const el = await open(fake.grillo);

    card(el)?.querySelector<HTMLInputElement>('.switch input')?.click();
    await flush();

    expect(card(el)?.querySelector<HTMLInputElement>('.switch input')?.checked).toBe(false);
  });

  it('shows the saved speech model mode and saves a new one through the transcription feature', async () => {
    const fake = fakeGrillo();
    const el = await open(fake.grillo);

    expect(pressedModes(el)).toEqual(['Ask']);
    buttonNamed(card(el)!, 'Automatic')?.click();
    await flush();

    expect(fake.calls('transcription:set-model-updates')).toEqual(['automatic']);
    expect(pressedModes(el)).toEqual(['Automatic']);
  });

  it('keeps the old speech model mode when saving the new one fails', async () => {
    const fake = fakeGrillo({ 'transcription:set-model-updates': () => Promise.reject(new Error('disk full')) });
    const el = await open(fake.grillo);

    buttonNamed(card(el)!, 'Never')?.click();
    await flush();

    expect(pressedModes(el)).toEqual(['Ask']);
  });

  it.each<[string, Handler, Handler]>([
    ['refused reads', () => Promise.reject(new Error('x')), () => Promise.reject(new Error('x'))],
    ['null answers', () => null, () => null],
    ['answers of the wrong shape', () => ({ ...NO_UPDATE, autoUpdate: 'on' }), () => 'sometimes'],
    ['an offer with no version', () => ({ ...OFFER, version: null }), () => 42],
  ])('locks the settings it could not read and offers nothing for %s', async (_case, updates, speech) => {
    const el = await open(
      fakeGrillo({ 'updates:get-state': updates, 'transcription:get-model-updates': speech }).grillo,
    );

    expect(card(el)?.querySelector<HTMLInputElement>('.switch input')?.disabled).toBe(true);
    expect(buttonNamed(card(el)!, 'Download and install')).toBeUndefined();
    expect([...card(el)!.querySelectorAll<HTMLButtonElement>('.seg button')].every((b) => b.disabled)).toBe(true);
  });
});

describe('setup check screen: leaving it', () => {
  it('stops listening to update events and ignores answers that arrive after it closed', async () => {
    const pending = deferred<ToolsReport>();
    const fake = fakeGrillo({ 'tools:check': () => pending.promise });
    const el = await open(fake.grillo);

    unmount?.();
    unmount = undefined;
    pending.resolve(ALL_GREEN);
    await flush();

    expect(fake.listenerCount()).toBe(0);
    expect(badges(rowNamed(el, CLAUDE))).toEqual(['Checking…']);
  });
});
