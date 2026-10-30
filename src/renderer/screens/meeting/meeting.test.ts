// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentChannels } from '../../../main/features/agents/channels';
import { FakePty } from '../../../main/features/agents/fake-pty';
import { ENTER_AFTER_QUIET_MS, WAITING_AFTER_MS } from '../../../main/features/agents/runtime';
import { createSliceBus } from '../../../main/features/audio/slices';
import { announcingTranscriber, registerSessionChannels } from '../../../main/features/session/channels';
import { createSessionHost } from '../../../main/features/session/session';
import { registerStoreIpc } from '../../../main/features/store/ipc';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { createMemoryStore } from '../../../main/store/memory';
import { createMemorySettings } from '../../../main/store/memory/settings';
import { createGrilloApi } from '../../../preload/bridge';
import type { TicketHold } from '../../../main/features/session/holds';
import type { StartCaptureResult } from '../../../shared/audio';
import type { AudioCapture } from '../../audio';
import { MICROPHONE_ENDED } from '../../audio/capture';
import { registerScreens, type ScreenModule } from '../../app/screens';
import { createShell, type Shell } from '../../app/shell';
import { FakeTerminalView } from '../../components/terminal/fake-terminal-view';
import { createAgentTabs, type AgentTabs } from '../agent-tab/agent-tabs';
import { registerTabPanels } from '../agent-tab/tab-panels';
import { terminalPanel } from '../agent-tab/terminal-panel';
import { channelSwitchPanel } from './channel-switch';
import {
  BEHIND_AFTER_SLICES,
  behindText,
  CONSENT_SCRIPT,
  HINT_CHANNELS,
  HINT_PARALLEL,
  LISTENING,
  OPEN_ANOTHER,
  meetingPanels,
  NOT_RECORDING,
  REASON_CONSENT,
  REASON_LISTEN,
  REASON_MODEL,
  SOURCE_HINT,
  SOURCE_LOCKED,
  USE_IT_HINT,
} from './controls-panel';
import { createMeetingAgents, MEETING_COMMAND, startMeetingAgent } from './meeting-agents';
import meetingTabPanels from './tab-panel';

// Made-up project, members and tickets only.
const NOW = new Date('2026-10-24T09:15:00.000Z');
const PROJECT = 'example-org/sample-project-1';
const HOST = 'ada-example';
const BEN = 'ben-example';
const CARLA = 'carla-example';
const ENTER = '\r';
const LINE_BREAK = '\n';
/** What Claude Code shows once it is ready for input; the runtime types the first message then. */
const PROMPT = '──────\r\n❯ ';

/** Claude Code shows its prompt, then the meeting command the runtime types into it; only then is Enter pressed. */
function showPromptAndTakeCommand(pty: FakePty): void {
  pty.print(PROMPT);
  pty.print(MEETING_COMMAND);
}

/** Stands in for the microphone: records what was asked, and the test hands slices to main itself. */
class FakeCapture implements AudioCapture {
  readonly calls: string[] = [];
  result: StartCaptureResult = { ok: true };

  async startCapture({ source }: { source: string }): Promise<StartCaptureResult> {
    this.calls.push(`start ${source}`);
    return this.result;
  }
  async stopCapture(): Promise<void> {
    this.calls.push('stop');
  }
  private readonly endedListeners = new Set<(message: string) => void>();
  onEnded(listener: (message: string) => void): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }
  /** The capture stops by itself, as when the microphone is unplugged. */
  end(message: string): void {
    this.calls.push('ended');
    for (const listener of [...this.endedListeners]) listener(message);
  }
  listInputDevices = async () => [];
  selectInputDevice = async () => undefined;
  selectedInputDevice = async () => null;
}

/** Lets every queued IPC call, store write, typed Enter and redraw finish. */
async function settle(): Promise<void> {
  for (let step = 0; step < 4; step += 1) await vi.advanceTimersByTimeAsync(ENTER_AFTER_QUIET_MS);
}

/**
 * The app as it runs, in process: the real agent channels (Claude Code played by fake terminals), the in-memory store
 * and the real live session behind their IPC (a fake transcriber and the slice bus in place of the microphone), a
 * speech model the test prepares, and the shell with the agent tab showing this folder's panels.
 */
async function app() {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const ptys: FakePty[] = [];
  const runtime = registerAgentChannels(ipc, {
    findClaude: () => '/opt/made-up/bin/claude',
    shipSkills: async () => undefined,
    spawnPty: (file, args, spawnOptions) => {
      const pty = new FakePty(file, args, spawnOptions);
      ptys.push(pty);
      return pty;
    },
    env: {},
  });
  const store = createMemoryStore({ now: () => new Date() });
  registerStoreIpc(ipc, store, createMemorySettings());
  const bus = createSliceBus();
  // Wired as src/main/features/session/ipc.ts wires it: each transcribed slice and each slice heard announce the
  // session. While `slow` is on, slices wait for the test to release them, as on a busy laptop.
  const transcription = { slow: false, waiting: [] as Array<() => void> };
  const changed = () => ipc.send('session:changed', host.state());
  const transcriber = announcingTranscriber(
    {
      transcribe: (pcm) => {
        const words = `Sample words ${pcm[0]}.`;
        if (!transcription.slow) return Promise.resolve(words);
        return new Promise((resolve) => transcription.waiting.push(() => resolve(words)));
      },
    },
    changed,
  );
  // The tickets the meeting agents hold, as the skill's hold folders would say; the test fills it in.
  const held: TicketHold[] = [];
  const host = createSessionHost({ store, slices: bus, transcriber, agents: runtime, sliceHeard: changed, holds: async () => held });
  registerSessionChannels(ipc, host);
  let modelReady: () => void = () => undefined;
  let modelFailed: (error: Error) => void = () => undefined;
  ipc.handle(
    'transcription:ensure-model',
    () =>
      new Promise<void>((resolve, reject) => {
        modelReady = resolve;
        modelFailed = reject;
      }),
  );

  await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } });
  await store.updateMember(PROJECT, HOST, { role: 'product owner', domains: ['product'] });
  await store.addMember(PROJECT, { login: BEN, role: 'developer', domains: ['developer'] });
  await store.addMember(PROJECT, { login: CARLA, role: 'platform', domains: ['platform'] });
  await store.createMap(PROJECT, { destination: 'A PRD for a sample product', notes: '', fog: [], outOfScope: [] });
  for (const title of ['Sample ticket 1', 'Sample ticket 5']) {
    await store.createTicket(PROJECT, { title, question: 'A made-up question?', whyItMatters: 'Made up.', assumptions: [], kind: 'grilling', blockers: [], questions: ['Sample question.'] });
  }
  const folder = await store.openProjectFolder(PROJECT);

  const grillo = createGrilloApi(fake.renderer);
  const meetingAgents = createMeetingAgents();
  const capture = new FakeCapture();
  // As in the app, every call makes a new capture: the first is `capture`, so a test can set its result beforehand.
  const captures: FakeCapture[] = [];
  const makeCapture = () => {
    const made = captures.length === 0 ? capture : new FakeCapture();
    captures.push(made);
    return made;
  };
  let tabs: AgentTabs | undefined;
  const panels = registerTabPanels({}, [
    terminalPanel(() => new FakeTerminalView()),
    ...meetingPanels({ agents: meetingAgents, capture: makeCapture }),
    channelSwitchPanel(),
  ]);
  const agentTabScreen: ScreenModule = {
    id: 'agent-tab',
    title: 'Agent',
    start(shellContext) {
      tabs = createAgentTabs(shellContext, panels);
      return () => tabs?.dispose();
    },
    mount: (el, params) => (tabs as AgentTabs).show(el, params['agentId'] ?? ''),
  };
  const root = document.createElement('div');
  document.body.append(root);
  shell = createShell(root, { grillo, screens: registerScreens({ '/src/renderer/screens/agent-tab/index.ts': agentTabScreen }) });

  const content = () => root.querySelector('main') as HTMLElement;
  return {
    store,
    host,
    held,
    bus,
    ptys,
    capture,
    transcription,
    /** Every capture still capturing the microphone: started more often than stopped. */
    microphonesOpen: () =>
      captures.filter((made) => made.calls.filter((call) => call === 'start microphone').length > made.calls.filter((call) => call === 'stop').length).length,
    captureCalls: () => captures.flatMap((made) => made.calls),
    grillo,
    folder,
    meetingAgents,
    modelReady: async () => {
      modelReady();
      await settle();
    },
    modelFailed: async (reason: string) => {
      modelFailed(new Error(reason));
      await settle();
    },
    progress: async (receivedBytes: number, totalBytes: number) => {
      ipc.send('transcription:model-progress', { receivedBytes, totalBytes });
      await settle();
    },
    content,
    /** The whole tab: the panel's parts sit in its column, in the slot above the body and below the body. */
    panel: () => content().querySelector<HTMLElement>('.agent-tab') as HTMLElement,
    /** Starts a meeting agent, opens its tab, and lets Claude Code show its prompt, take the command and go quiet. */
    async startMeeting() {
      const id = await startMeetingAgent(grillo, meetingAgents, { project: PROJECT, folder });
      await settle();
      shell?.navigate('agent-tab', { agentId: id });
      await settle();
      showPromptAndTakeCommand(ptys.at(-1) as FakePty);
      await vi.advanceTimersByTimeAsync(WAITING_AFTER_MS + ENTER_AFTER_QUIET_MS);
      await settle();
      return { id, pty: ptys.at(-1) as FakePty };
    },
  };
}

let shell: Shell | undefined;

afterEach(() => {
  shell?.dispose();
  shell = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? '';
const buttonNamed = (scope: HTMLElement, label: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => text(candidate) === label) as HTMLButtonElement;
const cardNamed = (scope: HTMLElement, heading: string) =>
  [...scope.querySelectorAll<HTMLElement>('.card')].find((card) => text(card.querySelector('h4')) === heading) as HTMLElement;
const checkNamed = (scope: HTMLElement, label: string) =>
  [...scope.querySelectorAll<HTMLLabelElement>('label')].find((candidate) => text(candidate).startsWith(label))?.querySelector('input') as HTMLInputElement;
const questionControls = (scope: HTMLElement) => scope.querySelector<HTMLElement>('.meeting-head') as HTMLElement;
const meetingPanelOf = (tab: HTMLElement) => tab.querySelector<HTMLElement>('.meeting-panel') as HTMLElement;
const recordSwitch = (scope: HTMLElement) => scope.querySelector<HTMLInputElement>('.switch input.rec') as HTMLInputElement;
const visible = (el: Element | null) => el !== null && !(el as HTMLElement).closest('[hidden]');
const sourceChoice = (scope: HTMLElement) => scope.querySelector<HTMLElement>('[role="group"][aria-label="Recording source"]') as HTMLElement;
/** The recording source as the group shows it: each choice with whether it is pressed and whether it can be pressed. */
const sources = (scope: HTMLElement) =>
  [...sourceChoice(scope).querySelectorAll('button')].map((choice) => ({
    label: text(choice),
    pressed: choice.getAttribute('aria-pressed') === 'true',
    disabled: choice.disabled,
  }));

async function click(target: HTMLElement): Promise<void> {
  target.click();
  await settle();
}
async function flip(box: HTMLInputElement, checked: boolean): Promise<void> {
  box.checked = checked;
  box.dispatchEvent(new Event('change'));
  await settle();
}
/** What was typed into the agent after its first message and Enter. */
const typedAfterCommand = (pty: FakePty) => pty.written.slice(pty.written.indexOf(MEETING_COMMAND) + 2);

describe('meeting screen: where the panels show', () => {
  it('shows the meeting controls on a meeting agent only, and the Open channel switch inside every agent tab', async () => {
    const { grillo, folder, panel, startMeeting } = await app();
    await grillo.invoke('agents:start', { kind: 'grilling', folder, firstMessage: '/grillo-tagging', title: 'Grilling · Tagging round' });
    await settle();

    const { id } = await startMeeting();

    expect(meetingPanelOf(panel()).hidden).toBe(false);
    expect(visible(panel().querySelector('.agent-tab-above .meeting-head'))).toBe(true);
    const tabs = [...document.querySelectorAll<HTMLElement>('nav .tab[data-agent-id]')];
    expect(tabs.map((tab) => text(tab.querySelector('.tab-name')))).toEqual(['Grilling · Tagging round', 'Grilling · Live session']);
    for (const tab of tabs) {
      const channel = tab.querySelector<HTMLInputElement>('.tab-header .switch input[aria-label="Open channel"]');
      expect(text(channel?.closest('label'))).toBe('Channel');
      expect(channel?.checked).toBe(false);
    }
    shell?.navigate('agent-tab', { agentId: tabs[0].dataset['agentId'] ?? '' });
    await settle();
    expect(meetingPanelOf(panel()).hidden).toBe(true);
    expect(visible(panel().querySelector('.agent-tab-above .meeting-head'))).toBe(false);
    expect(tabs[1].dataset['agentId']).toBe(id);
  });

  it('is found by the agent tab through its tab-panel.ts: the controls for grilling agents, the switch for all kinds', () => {
    const panels = registerTabPanels({ '/src/renderer/screens/meeting/tab-panel.ts': { default: meetingTabPanels } }, [terminalPanel()]);

    expect(panels.panelsFor('grilling', 'controls')).toHaveLength(1);
    expect(panels.panelsFor('grilling', 'above')).toHaveLength(1);
    expect(panels.panelsFor('generic', 'controls')).toEqual([]);
    expect(panels.panelsFor('generic', 'above')).toEqual([]);
    for (const kind of ['grilling', 'research', 'prototype', 'task', 'support', 'generic'] as const) {
      expect(panels.panelsFor(kind, 'header')).toHaveLength(1);
    }
  });
});

describe('meeting screen: its states', () => {
  it('Preparing speech model: shows the download progress and keeps Record off until the model is ready', async () => {
    const { panel, progress, modelReady, startMeeting } = await app();
    await startMeeting();
    await progress(42, 100);

    const status = panel().querySelector<HTMLElement>('[role="status"].card') as HTMLElement;
    expect(text(status.querySelector('.row'))).toBe('PreparingPreparing speech model (downloading, 42%)');
    expect(status.querySelector('progress')?.value).toBe(42);
    expect(recordSwitch(panel()).disabled).toBe(true);
    expect(text(cardNamed(panel(), 'Recording').querySelector('.reason'))).toBe(REASON_MODEL);
    expect(sources(panel())).toEqual([
      { label: 'Room microphone', pressed: true, disabled: false },
      { label: 'Call audio', pressed: false, disabled: false },
    ]);
    expect(buttonNamed(panel(), 'Type').getAttribute('aria-pressed')).toBe('true');

    await modelReady();

    expect(visible(status)).toBe(false);
    expect(text(cardNamed(panel(), 'Recording').querySelector('.reason'))).toBe(REASON_CONSENT);
  });

  it('says why the speech model is not ready and tries again on request', async () => {
    const { panel, modelFailed, modelReady, startMeeting } = await app();
    await startMeeting();

    await modelFailed('The download stopped halfway');
    const status = panel().querySelector<HTMLElement>('[role="status"].card') as HTMLElement;
    expect(text(status.querySelector('.row'))).toBe('Not readyThe speech model could not be prepared: The download stopped halfway');
    await click(buttonNamed(status, 'Try again'));
    await modelReady();

    expect(visible(status)).toBe(false);
  });

  it('Before consent: shows the script, keeps Record disabled, and records the tick with the host and the time', async () => {
    const { host, panel, modelReady, startMeeting } = await app();
    await startMeeting();
    await modelReady();
    const consent = cardNamed(panel(), 'Consent');

    expect(text(consent.querySelector('.script'))).toBe(CONSENT_SCRIPT);
    expect(recordSwitch(panel()).disabled).toBe(true);
    expect(sources(panel()).map(({ pressed }) => pressed)).toEqual([true, false]);
    expect(text(cardNamed(panel(), 'Recording').querySelector('p.small.muted'))).toBe(SOURCE_HINT);
    expect(text(panel().querySelector('.transcript'))).toBe(NOT_RECORDING);
    expect(text(cardNamed(panel(), 'Recording').nextElementSibling)).toBe('');
    await flip(checkNamed(consent, 'Everyone here agreed'), true);

    expect(host.state()?.consent?.by).toBe(HOST);
    expect(text(consent.querySelector('p.small'))).toMatch(new RegExp(`^Ticked by ${HOST} at \\d\\d:\\d\\d\\.$`));
    expect(visible(consent.querySelector('.script'))).toBe(false);
    expect(checkNamed(consent, 'Everyone here agreed').disabled).toBe(true);
    expect(recordSwitch(panel()).disabled).toBe(false);
    expect(visible(cardNamed(panel(), 'Recording').querySelector('.reason'))).toBe(false);
  });

  it('Recording, Listen: Record captures the microphone, shows the red banner, and the strip shows each transcribed slice', async () => {
    const { host, bus, capture, panel, modelReady, startMeeting } = await app();
    const { id, pty } = await startMeeting();
    await modelReady();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);

    await flip(recordSwitch(panel()), true);
    expect(capture.calls).toEqual(['start microphone']);
    expect(host.state()?.recording).toBe(true);
    const banner = panel().querySelector('.rec-banner') as HTMLElement;
    expect(visible(banner)).toBe(true);
    expect(text(banner)).toMatch(/^Recording· audio and transcription stay on this laptop00:00:0\d$/);
    expect(text(panel().querySelector('.transcript'))).toBe(LISTENING);

    await click(buttonNamed(panel(), 'Listen'));
    expect(buttonNamed(panel(), 'Listen').getAttribute('aria-pressed')).toBe('true');
    expect(host.state()?.channels).toEqual([id]);
    expect(document.querySelector<HTMLInputElement>(`nav .tab[data-agent-id="${id}"] .tab-header input`)?.checked).toBe(true);
    expect(text(panel().querySelector('.meeting-head .card:not([role]) p'))).toBe(USE_IT_HINT);
    pty.written.length = 0;

    bus.publish({ source: 'microphone', index: 0, pcm: Int16Array.of(1) });
    bus.publish({ source: 'microphone', index: 1, pcm: Int16Array.of(2) });
    await settle();
    expect([...panel().querySelectorAll('.transcript p')].map(text)).toEqual([
      expect.stringMatching(/^\d\d:\d\d:\d\d Sample words 1\.$/),
      expect.stringMatching(/^\d\d:\d\d:\d\d Sample words 2\.$/),
    ]);
    await click(buttonNamed(questionControls(panel()), 'Use it'));

    expect(pty.written).toEqual(['Sample words 1.', `${LINE_BREAK}Sample words 2.`, `${LINE_BREAK}use it`, ENTER]);
  });

  it('Recording, Type: types the mode, and Record off stops the capture, saves the transcript and goes back to Type', async () => {
    const { host, store, bus, capture, panel, modelReady, startMeeting } = await app();
    const { pty } = await startMeeting();
    await modelReady();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);
    await flip(recordSwitch(panel()), true);
    await click(buttonNamed(panel(), 'Listen'));
    bus.publish({ source: 'microphone', index: 0, pcm: Int16Array.of(3) });
    await settle();
    pty.written.length = 0;

    await click(buttonNamed(panel(), 'Type'));
    expect(buttonNamed(questionControls(panel()), 'Use it').disabled).toBe(true);
    await flip(recordSwitch(panel()), false);

    expect(pty.written).toEqual([`${LINE_BREAK}mode: type`, ENTER]);
    expect(capture.calls).toEqual(['start microphone', 'stop']);
    const { id: sessionId } = host.state()!;
    expect((await store.getSession(PROJECT, sessionId)).transcript).toBe('Sample words 3.');
    expect(visible(panel().querySelector('.rec-banner'))).toBe(false);
    expect(buttonNamed(panel(), 'Listen').disabled).toBe(true);
    expect(text(panel().querySelector('.meeting-head .reason'))).toBe(REASON_LISTEN);
  });

  it('Record with "call audio" chosen starts the call-audio capture, not the microphone', async () => {
    const { host, capture, panel, modelReady, startMeeting } = await app();
    await startMeeting();
    await modelReady();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);

    await click(buttonNamed(sourceChoice(panel()), 'Call audio'));
    expect(sources(panel()).map(({ pressed }) => pressed)).toEqual([false, true]);
    await flip(recordSwitch(panel()), true);

    expect(capture.calls).toEqual(['start call']);
    expect(host.state()?.recording).toBe(true);
    expect(sources(panel())).toEqual([
      { label: 'Room microphone', pressed: false, disabled: true },
      { label: 'Call audio', pressed: true, disabled: true },
    ]);
  });

  it('switching the source while recording is refused: the choice is locked, with the hint to turn Record off', async () => {
    const { capture, panel, modelReady, startMeeting } = await app();
    await startMeeting();
    await modelReady();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);
    await flip(recordSwitch(panel()), true);
    const recording = cardNamed(panel(), 'Recording');

    expect(text(recording.querySelector('.reason'))).toBe(SOURCE_LOCKED);
    expect(visible(recording.querySelector('p.small.muted'))).toBe(false);
    buttonNamed(sourceChoice(panel()), 'Call audio').dispatchEvent(new MouseEvent('click'));
    await settle();

    expect(sources(panel())).toEqual([
      { label: 'Room microphone', pressed: true, disabled: true },
      { label: 'Call audio', pressed: false, disabled: true },
    ]);
    expect(capture.calls).toEqual(['start microphone']);
    await flip(recordSwitch(panel()), false);
    expect(visible(recording.querySelector('.reason'))).toBe(false);
    expect(sources(panel()).map(({ disabled }) => disabled)).toEqual([false, false]);
  });

  it('Recording stopped by itself: an unplugged microphone turns Record off, the panel says why, and Listen falls back to Type', async () => {
    const { host, store, bus, capture, panel, modelReady, startMeeting } = await app();
    const { pty } = await startMeeting();
    await modelReady();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);
    await flip(recordSwitch(panel()), true);
    await click(buttonNamed(panel(), 'Listen'));
    bus.publish({ source: 'microphone', index: 0, pcm: Int16Array.of(4) });
    await settle();
    pty.written.length = 0;

    capture.end(MICROPHONE_ENDED);
    await settle();

    expect(host.state()?.recording).toBe(false);
    expect(recordSwitch(panel()).checked).toBe(false);
    expect(visible(panel().querySelector('.rec-banner'))).toBe(false);
    expect(text(panel().querySelector('.note.err'))).toBe(MICROPHONE_ENDED);
    expect(buttonNamed(panel(), 'Type').getAttribute('aria-pressed')).toBe('true');
    expect(pty.written).toEqual([`${LINE_BREAK}mode: type`, ENTER]);
    expect((await store.getSession(PROJECT, host.state()!.id)).transcript).toBe('Sample words 4.');

    await flip(recordSwitch(panel()), true);
    expect(capture.calls).toEqual(['start microphone', 'ended', 'start microphone']);
    expect(host.state()?.recording).toBe(true);
    expect(panel().querySelector('.note.err')).toBeNull();
  });

  it('Recording stopped by itself while the transcript cannot be saved: the panel says both', async () => {
    const { store, bus, capture, panel, modelReady, startMeeting } = await app();
    await startMeeting();
    await modelReady();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);
    await flip(recordSwitch(panel()), true);
    vi.spyOn(store, 'updateSession').mockRejectedValue(new Error('made-up store outage'));
    bus.publish({ source: 'microphone', index: 0, pcm: Int16Array.of(5) });
    await settle();

    capture.end(MICROPHONE_ENDED);
    await settle();

    expect(recordSwitch(panel()).checked).toBe(false);
    expect(text(panel().querySelector('.note.err'))).toBe(
      `${MICROPHONE_ENDED} The transcript could not be written to the session file; try again`,
    );
  });

  it('Transcription behind: with more than two slices waiting the panel says so, and the note goes once they are in', async () => {
    const { bus, transcription, panel, modelReady, startMeeting } = await app();
    await startMeeting();
    await modelReady();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);
    await flip(recordSwitch(panel()), true);
    const behind = () => panel().querySelector<HTMLElement>('.meeting-foot .note.warn[role="status"]');
    transcription.slow = true;

    for (let index = 0; index < BEHIND_AFTER_SLICES; index += 1) bus.publish({ source: 'microphone', index, pcm: Int16Array.of(index) });
    await settle();
    expect(visible(behind())).toBe(false);
    bus.publish({ source: 'microphone', index: BEHIND_AFTER_SLICES, pcm: Int16Array.of(BEHIND_AFTER_SLICES) });
    await settle();
    expect(visible(behind())).toBe(true);
    expect(text(behind())).toBe(behindText(BEHIND_AFTER_SLICES + 1));

    for (const release of transcription.waiting.splice(0)) release();
    await settle();
    expect(visible(behind())).toBe(false);
    expect(panel().querySelectorAll('.transcript p')).toHaveLength(BEHIND_AFTER_SLICES + 1);
  });

  it('turns the recording back off and says why when the microphone cannot be opened', async () => {
    const { host, capture, panel, modelReady, startMeeting } = await app();
    await startMeeting();
    await modelReady();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);
    capture.result = { ok: false, reason: 'permission-denied', message: 'Grillo may not use the microphone. Allow it in Settings.' };

    await flip(recordSwitch(panel()), true);

    expect(host.state()?.recording).toBe(false);
    expect(recordSwitch(panel()).checked).toBe(false);
    expect(text(panel().querySelector('.note.err'))).toBe('Grillo may not use the microphone. Allow it in Settings.');
  });
});

describe('meeting screen: another grilling agent', () => {
  const agentRows = (scope: HTMLElement) => [...cardNamed(scope, 'Grilling agents').querySelectorAll('li')];
  const tickConsent = (scope: HTMLElement) => flip(checkNamed(cardNamed(scope, 'Consent'), 'Everyone here agreed'), true);

  it('lists the grilling agents of the session once consent is ticked, this one selected, with a control to open another', async () => {
    const { panel, startMeeting } = await app();
    await startMeeting();
    expect(cardNamed(panel(), 'Grilling agents')).toBeUndefined();

    await tickConsent(panel());

    const card = cardNamed(panel(), 'Grilling agents');
    expect(agentRows(panel()).map(text)).toEqual(['Grilling · Live sessionChannel closed']);
    expect(agentRows(panel())[0].classList.contains('selected')).toBe(true);
    expect(buttonNamed(card, OPEN_ANOTHER).disabled).toBe(false);
    expect(text(card.querySelector('p'))).toBe(HINT_PARALLEL);
  });

  it('opens another grilling agent with /grillo-meeting in its own tab, which joins the running session', async () => {
    const { host, ptys, panel, startMeeting } = await app();
    const first = await startMeeting();
    await tickConsent(panel());
    const sessionBefore = host.state();

    await click(buttonNamed(cardNamed(panel(), 'Grilling agents'), OPEN_ANOTHER));
    const second = ptys.at(-1) as FakePty;
    showPromptAndTakeCommand(second);
    await vi.advanceTimersByTimeAsync(WAITING_AFTER_MS + ENTER_AFTER_QUIET_MS);
    await settle();

    expect(ptys).toHaveLength(2);
    expect(second.written.slice(0, 2)).toEqual([MEETING_COMMAND, ENTER]);
    const tabs = [...document.querySelectorAll<HTMLElement>('nav .tab[data-agent-id]')];
    expect(tabs).toHaveLength(2);
    const secondId = tabs[1].dataset['agentId'] ?? '';
    expect(secondId).not.toBe(first.id);
    expect(tabs[1].classList.contains('active')).toBe(true);
    expect(tabs[1].querySelector<HTMLInputElement>('.tab-header input[aria-label="Open channel"]')?.checked).toBe(false);
    // One session for both: the new agent hears the same session file and who is present, in Type until it listens.
    expect(host.state()?.id).toBe(sessionBefore?.id);
    expect(typedAfterCommand(second)).toEqual([`session: ${sessionBefore!.file}`, ENTER, `present: ${HOST}`, ENTER, 'mode: type', ENTER]);
    expect(agentRows(panel()).map(text)).toEqual(['Grilling · Live sessionChannel closed', 'Grilling · Live session NewChannel closed']);
    expect(agentRows(panel()).map((row) => row.classList.contains('selected'))).toEqual([false, true]);
    expect(text(cardNamed(panel(), 'Grilling agents').querySelector('p'))).toBe(HINT_CHANNELS);
  });

  it('gives each grilling agent the transcript only while its own channel is open', async () => {
    const { bus, ptys, panel, modelReady, startMeeting } = await app();
    const first = await startMeeting();
    await modelReady();
    await tickConsent(panel());
    await flip(recordSwitch(panel()), true);
    await click(buttonNamed(panel(), 'Listen'));
    await click(buttonNamed(cardNamed(panel(), 'Grilling agents'), OPEN_ANOTHER));
    const second = ptys.at(-1) as FakePty;
    showPromptAndTakeCommand(second);
    await vi.advanceTimersByTimeAsync(WAITING_AFTER_MS + ENTER_AFTER_QUIET_MS);
    await settle();
    const channelOf = (id: string) =>
      document.querySelector<HTMLInputElement>(`nav .tab[data-agent-id="${id}"] .tab-header input`) as HTMLInputElement;
    const secondId = [...document.querySelectorAll<HTMLElement>('nav .tab[data-agent-id]')][1].dataset['agentId'] ?? '';
    first.pty.written.length = 0;
    second.written.length = 0;

    bus.publish({ source: 'microphone', index: 0, pcm: Int16Array.of(1) });
    await settle();
    expect(first.pty.written).toEqual(['Sample words 1.']);
    expect(second.written).toEqual([]);
    expect(agentRows(panel()).map(text)).toEqual(['Grilling · Live sessionChannel open', 'Grilling · Live session NewChannel closed']);

    await click(buttonNamed(panel(), 'Listen'));
    expect(channelOf(secondId).checked).toBe(true);
    await flip(channelOf(first.id), false);
    first.pty.written.length = 0;
    second.written.length = 0;
    bus.publish({ source: 'microphone', index: 1, pcm: Int16Array.of(2) });
    await settle();

    expect(first.pty.written).toEqual([]);
    expect(second.written).toEqual(['Sample words 2.']);
    expect(agentRows(panel()).map(text)).toEqual(['Grilling · Live sessionChannel closed', 'Grilling · Live sessionChannel open']);
  });

  /** Opens another grilling agent from the panel on show and lets its Claude Code take the command and go quiet. */
  async function openAnother(ptys: FakePty[], scope: HTMLElement): Promise<void> {
    await click(buttonNamed(cardNamed(scope, 'Grilling agents'), OPEN_ANOTHER));
    showPromptAndTakeCommand(ptys.at(-1) as FakePty);
    await vi.advanceTimersByTimeAsync(WAITING_AFTER_MS + ENTER_AFTER_QUIET_MS);
    await settle();
  }

  it('shares one microphone between the tabs: Record off in one tab stops what Record on in another started', async () => {
    const { host, ptys, panel, modelReady, startMeeting, microphonesOpen, captureCalls } = await app();
    const first = await startMeeting();
    await modelReady();
    await tickConsent(panel());
    await flip(recordSwitch(panel()), true);
    await openAnother(ptys, panel());
    expect(recordSwitch(panel()).checked).toBe(true);

    await flip(recordSwitch(panel()), false);
    expect(host.state()?.recording).toBe(false);
    expect(microphonesOpen()).toBe(0);
    await flip(recordSwitch(panel()), true);
    expect(microphonesOpen()).toBe(1);
    shell?.navigate('agent-tab', { agentId: first.id });
    await settle();
    expect(recordSwitch(panel()).checked).toBe(true);
    await flip(recordSwitch(panel()), false);

    expect(panel().querySelector('.note.err')).toBeNull();
    expect(host.state()?.recording).toBe(false);
    expect(captureCalls()).toEqual(['start microphone', 'stop', 'start microphone', 'stop']);
  });

  it('shares the source choice between the tabs, as the one capture is shared', async () => {
    const { ptys, panel, modelReady, startMeeting, captureCalls } = await app();
    await startMeeting();
    await modelReady();
    await tickConsent(panel());
    await click(buttonNamed(sourceChoice(panel()), 'Call audio'));

    await openAnother(ptys, panel());
    expect(sources(panel()).map(({ pressed }) => pressed)).toEqual([false, true]);
    await flip(recordSwitch(panel()), true);

    expect(captureCalls()).toEqual(['start call']);
  });

  it('lets the other tab stop the microphone after the agent that started it stops', async () => {
    const { host, grillo, ptys, panel, modelReady, startMeeting, microphonesOpen } = await app();
    const first = await startMeeting();
    await modelReady();
    await tickConsent(panel());
    await flip(recordSwitch(panel()), true);
    await openAnother(ptys, panel());

    await grillo.invoke('agents:stop', { id: first.id });
    await settle();
    expect(host.state()?.recording).toBe(true);
    await flip(recordSwitch(panel()), false);

    expect(host.state()?.recording).toBe(false);
    expect(microphonesOpen()).toBe(0);
  });

  it('says why when another grilling agent cannot be started, and stays on this tab', async () => {
    const { grillo, panel, startMeeting } = await app();
    const first = await startMeeting();
    await tickConsent(panel());
    const invoke = grillo.invoke.bind(grillo);
    vi.spyOn(grillo, 'invoke').mockImplementation(((channel: string, args: unknown) =>
      channel === 'agents:start' ? Promise.reject(new Error('Claude Code could not start')) : invoke(channel as never, args as never)) as typeof grillo.invoke);

    await click(buttonNamed(cardNamed(panel(), 'Grilling agents'), OPEN_ANOTHER));

    expect(text(panel().querySelector('.note.err'))).toBe('Claude Code could not start');
    expect(document.querySelectorAll('nav .tab[data-agent-id]')).toHaveLength(1);
    expect(document.querySelector('nav .tab.active')?.getAttribute('data-agent-id')).toBe(first.id);
  });
});

describe("meeting screen: each meeting agent's tab names its ticket", () => {
  const tabNames = () => [...document.querySelectorAll('nav .tab[data-agent-id] .tab-name')].map(text);
  /** The agent says something, then goes quiet: the tab's dot comes on. */
  async function talkThenWait(pty: FakePty): Promise<void> {
    pty.print('A made-up question for the room.\r\n');
    await vi.advanceTimersByTimeAsync(WAITING_AFTER_MS + ENTER_AFTER_QUIET_MS);
    await settle();
  }

  it('titles each tab after the ticket its agent holds once it goes quiet, and renames it when the agent moves on', async () => {
    const { store, held, ptys, panel, startMeeting } = await app();
    const [one, five] = await store.listTickets(PROJECT, { state: 'open' });
    const first = await startMeeting();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);
    await click(buttonNamed(cardNamed(panel(), 'Grilling agents'), OPEN_ANOTHER));
    const second = ptys.at(-1) as FakePty;
    showPromptAndTakeCommand(second);
    await vi.advanceTimersByTimeAsync(WAITING_AFTER_MS + ENTER_AFTER_QUIET_MS);
    await settle();
    const secondId = [...document.querySelectorAll<HTMLElement>('nav .tab[data-agent-id]')][1].dataset['agentId'] ?? '';
    expect(tabNames()).toEqual(['Grilling · Live session', 'Grilling · Live session']);

    held.push({ ticket: one.id.number, agentId: first.id, heldAt: 1 }, { ticket: five.id.number, agentId: secondId, heldAt: 1 });
    await talkThenWait(first.pty);
    await talkThenWait(second);

    expect(tabNames()).toEqual(['Grilling · Sample ticket 1', 'Grilling · Sample ticket 5']);
    expect([...cardNamed(panel(), 'Grilling agents').querySelectorAll('li > span:first-child')].map(text)).toEqual([
      'Grilling · Sample ticket 1',
      'Grilling · Sample ticket 5 New',
    ]);

    // The first agent closes its ticket and takes one added during the meeting, which the panel has not read yet.
    const added = await store.createTicket(PROJECT, {
      title: 'Sample ticket 7',
      question: 'A made-up question?',
      whyItMatters: 'Made up.',
      assumptions: [],
      kind: 'grilling',
      blockers: [],
      questions: ['Sample question.'],
    });
    held.splice(0, 1, { ticket: added.id.number, agentId: first.id, heldAt: 2 });
    await talkThenWait(first.pty);

    expect(tabNames()).toEqual(['Grilling · Sample ticket 7', 'Grilling · Sample ticket 5']);

    // Nothing left that matches who is present: the agent holds no ticket, and its tab says so again.
    held.splice(0, 1);
    await talkThenWait(first.pty);

    expect(tabNames()).toEqual(['Grilling · Live session', 'Grilling · Sample ticket 5']);
  });

  it('never shows the red Recording banner while nothing records, by the real stylesheet', async () => {
    const { panel, startMeeting } = await app();
    await startMeeting();
    const sheet = document.createElement('style');
    sheet.textContent = readFileSync(resolve(__dirname, 'meeting.css'), 'utf8');
    document.head.append(sheet);

    expect(getComputedStyle(panel().querySelector('.rec-banner') as HTMLElement).display).toBe('none');
    sheet.remove();
  });

  it('shows the ticket at hand on the question card: its title, domain tags and "Question n of m", as the agent says', async () => {
    const { store, held, panel, startMeeting } = await app();
    const [one, five] = await store.listTickets(PROJECT, { state: 'open' });
    await store.updateTicket(one.id, { domains: ['developer', 'product'] });
    const heading = () => questionControls(panel()).querySelector<HTMLElement>('.question-at-hand') as HTMLElement;
    const { id, pty } = await startMeeting();

    expect(visible(heading())).toBe(false);

    held.push({ ticket: one.id.number, agentId: id, heldAt: 1, question: { at: 2, of: 3 } });
    await talkThenWait(pty);

    expect(visible(heading())).toBe(true);
    expect(text(heading().querySelector('.strong'))).toBe('Sample ticket 1');
    expect([...heading().querySelectorAll('.tag')].map(text)).toEqual(['developer', 'product']);
    expect(heading().querySelector('.tag')?.className).toBe('tag d2');
    expect(text(heading().querySelector('.question-count'))).toBe('Question 2 of 3');
    // The heading comes first on the card, above the Listen or Type controls.
    expect(heading().nextElementSibling?.querySelector('[aria-label="Answer mode"]')).not.toBeNull();

    // The agent moves on and has not said which question yet: the card names the ticket and no count.
    held.splice(0, 1, { ticket: five.id.number, agentId: id, heldAt: 2 });
    await talkThenWait(pty);

    expect(text(heading().querySelector('.strong'))).toBe('Sample ticket 5');
    expect(heading().querySelector('.question-count')).toBeNull();

    // It holds no ticket any more: the card has nothing to name.
    held.splice(0, 1);
    await talkThenWait(pty);

    expect(visible(heading())).toBe(false);
  });

  it('keeps the question card working when the agent\'s question cannot be read', async () => {
    const { store, host, held, panel, startMeeting } = await app();
    const [one] = await store.listTickets(PROJECT, { state: 'open' });
    const { id, pty } = await startMeeting();
    held.push({ ticket: one.id.number, agentId: id, heldAt: 1, question: { at: 1, of: 1 } });
    vi.spyOn(host, 'questionAtHand').mockRejectedValueOnce(new Error('made-up read failure'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await talkThenWait(pty);

    expect(text(questionControls(panel()).querySelector('.question-at-hand .strong'))).toBe('Sample ticket 1');
    expect(buttonNamed(questionControls(panel()), 'Skip question').disabled).toBe(false);
    warn.mockRestore();
  });

  it("names the meeting's project in the title bar while its tab is open", async () => {
    const { startMeeting } = await app();

    await startMeeting();

    expect(text(document.querySelector('.titlebar .project'))).toBe(PROJECT);
  });
});

describe('meeting agents: the list the panels share', () => {
  it('remembers each agent once, marks the extra ones, and ignores unknown ids', () => {
    const agents = createMeetingAgents();
    const changes = vi.fn();
    agents.onChange(changes);

    agents.remember('a1', PROJECT);
    agents.remember('a2', PROJECT, { extra: true });
    agents.remember('a1', PROJECT);
    agents.forget('no-such-agent');

    expect(agents.count()).toBe(2);
    expect([agents.isExtra('a1'), agents.isExtra('a2'), agents.isExtra('no-such-agent')]).toEqual([false, true, false]);
    expect(changes).toHaveBeenCalledTimes(3);
    agents.forget('a2');
    expect(agents.isExtra('a2')).toBe(false);
    expect(agents.count()).toBe(1);
  });
});

describe('meeting screen: the controls call the session', () => {
  it('starts the session with the host present, then types the session file, present and mode once the agent is ready', async () => {
    const { host, store, panel, startMeeting } = await app();

    const { pty } = await startMeeting();

    const state = host.state();
    expect(state).toMatchObject({ project: PROJECT, present: [HOST] });
    expect((await store.getSession(PROJECT, state!.id)).present).toEqual([HOST]);
    // resources/skills/README.md, Session row: every meeting agent is told the session file, channel open or not.
    expect(typedAfterCommand(pty)).toEqual([`session: ${state!.file}`, ENTER, `present: ${HOST}`, ENTER, 'mode: type', ENTER]);
    const present = cardNamed(panel(), 'Present');
    expect([...present.querySelectorAll('label')].map(text)).toEqual([
      `${HOST} · Ada Example productHost`,
      `${BEN} developer`,
      `${CARLA} platform`,
    ]);
    expect(text(present.querySelector('p'))).toBe('Used only to pick tickets: product and no-domain tickets come up. Change it at any time.');
  });

  it('records each presence tick in the session and types the new presence into the agent', async () => {
    const { host, panel, startMeeting } = await app();
    const { pty } = await startMeeting();
    pty.written.length = 0;

    await flip(checkNamed(cardNamed(panel(), 'Present'), BEN), true);
    await flip(checkNamed(cardNamed(panel(), 'Present'), HOST), false);

    expect(host.state()?.present).toEqual([BEN]);
    expect(pty.written).toEqual([`present: ${HOST}, ${BEN}`, ENTER, `present: ${BEN}`, ENTER]);
  });

  it('types skip, and jump with the number of the ticket picked', async () => {
    const { store, panel, startMeeting } = await app();
    const { pty } = await startMeeting();
    const [, five] = await store.listTickets(PROJECT, { state: 'open' });
    pty.written.length = 0;

    await click(buttonNamed(panel(), 'Skip question'));
    const jump = panel().querySelector<HTMLSelectElement>('select[aria-label="Jump to ticket"]') as HTMLSelectElement;
    expect([...jump.options].map(text)).toEqual(['Jump to ticket…', 'Sample ticket 1', 'Sample ticket 5']);
    jump.value = String(five.id.number);
    jump.dispatchEvent(new Event('change'));
    await settle();

    expect(pty.written).toEqual(['skip', ENTER, `jump ${five.id.number}`, ENTER]);
    expect(jump.value).toBe('');
  });

  it('types an imported transcript with "use it" on its own last line', async () => {
    const { panel, startMeeting } = await app();
    const { pty } = await startMeeting();
    pty.written.length = 0;

    await click(buttonNamed(panel(), 'Import a transcript (paste or upload)'));
    const field = panel().querySelector<HTMLTextAreaElement>('textarea[aria-label="Transcript"]') as HTMLTextAreaElement;
    field.value = 'Sample pasted line.\r\nSample reply.';
    field.dispatchEvent(new Event('input'));
    await settle();
    await click(buttonNamed(cardNamed(panel(), 'Recording'), 'Use it'));
    // Claude Code echoes the typed message; Enter waits for that echo to settle.
    pty.print('Sample pasted line.\r\n  Sample reply.\r\n  use it');
    await settle();

    expect(pty.written).toEqual(['Sample pasted line.\nSample reply.\nuse it', ENTER]);
    expect(text(panel().querySelector('.note.ok'))).toBe('Transcript sent with "use it": the agent takes the answer from it.');
  });

  it('shows the channel as the session holds it when no session runs: it stays on, and turns off again', async () => {
    const { host, grillo, folder } = await app();
    const generic = await grillo.invoke('agents:start', { kind: 'generic', folder, firstMessage: '/grillo-generic', title: 'Generic · Sample notes' });
    await settle();
    const channel = document.querySelector<HTMLInputElement>(`nav .tab[data-agent-id="${generic}"] .tab-header input`) as HTMLInputElement;

    await flip(channel, true);
    expect(host.state()).toBeNull();
    expect(host.channels()).toEqual([generic]);
    expect(channel.checked).toBe(true);
    await flip(channel, false);

    expect(host.channels()).toEqual([]);
    expect(channel.checked).toBe(false);
  });

  it("opens and closes any agent's channel from the switch in its tab", async () => {
    const { host, grillo, folder, startMeeting } = await app();
    await startMeeting();
    const generic = await grillo.invoke('agents:start', { kind: 'generic', folder, firstMessage: '/grillo-generic', title: 'Generic · Sample notes' });
    await settle();
    const channel = document.querySelector<HTMLInputElement>(`nav .tab[data-agent-id="${generic}"] .tab-header input`) as HTMLInputElement;

    await flip(channel, true);
    expect(host.state()?.channels).toEqual([generic]);
    await flip(channel, false);

    expect(host.state()?.channels).toEqual([]);
    expect(channel.checked).toBe(false);
  });

  it('keeps the session running while another meeting agent remains, and drops the stopped one from the list', async () => {
    const { host, grillo, panel, startMeeting } = await app();
    const first = await startMeeting();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);
    await click(buttonNamed(cardNamed(panel(), 'Grilling agents'), OPEN_ANOTHER));
    const sessionId = host.state()?.id;

    await grillo.invoke('agents:stop', { id: first.id });
    await settle();

    expect(host.state()?.id).toBe(sessionId);
    expect([...cardNamed(panel(), 'Grilling agents').querySelectorAll('li')].map(text)).toEqual([
      'Grilling · Live session NewChannel closed',
    ]);
  });

  it('ends the session, its transcript saved, when the last meeting agent stops', async () => {
    const { host, grillo, panel, modelReady, startMeeting } = await app();
    const { id } = await startMeeting();
    await modelReady();
    await flip(checkNamed(cardNamed(panel(), 'Consent'), 'Everyone here agreed'), true);
    await flip(recordSwitch(panel()), true);

    await grillo.invoke('agents:stop', { id });
    await settle();

    expect(host.state()).toBeNull();
  });
});
