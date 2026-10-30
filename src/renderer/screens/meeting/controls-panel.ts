/**
 * The meeting screen (prototype `screen-meeting`) on a meeting agent's tab: who is present, the consent tick with the
 * read-aloud script, the recording source (room microphone or call audio, locked while recording), the one Record
 * switch with the red Recording banner, the speech model being prepared before the first recording, Listen or Type,
 * "Use it", skip and jump, an imported transcript and the running transcript strip (PRD 4.5, 4.6 item 4), and the
 * session's grilling agents with "Open another grilling agent" (PRD 4.5 item 9). A capture that stops by itself (the
 * microphone unplugged) turns Record off and says why; slices queuing for the speech model show as "behind".
 *
 * The controls call the live session in main (`session:*`); the session types the protocol messages
 * (`resources/skills/README.md`, Screen-to-agent protocol) into the agent and writes the transcript file. On any
 * other grilling agent the panel stays hidden.
 */
import './meeting.css';
import type { Member, Ticket } from '../../../main/store/types';
import type { AgentInfo } from '../../../shared/agents';
import { type CaptureSource, SLICE_SECONDS } from '../../../shared/audio';
import type { AgentMode, SessionState, SliceCounts } from '../../../shared/session';
import { createSessionClient } from '../../../shared/session-ipc';
import { createStoreClient } from '../../../shared/store';
import { AGENT_SCREEN } from '../../app/navigation';
import type { AudioCapture } from '../../audio';
import { badge, button, toggle } from '../../theme/components';
import type { TabPanel } from '../agent-tab/tab-panels';
import { el, messageOf, note } from '../map/view';
import { sendUseIt } from '../own-time/agents';
import { startMeetingAgent, type MeetingAgents } from './meeting-agents';

/** Below the own-time panel, which never shows on a meeting agent anyway. */
export const MEETING_PANEL_PRIORITY = 5;
export const CONSENT_SCRIPT = '"This call is recorded and transcribed by Grillo."';
export const CONSENT_LABEL = 'Everyone here agreed';

export const REASON_MODEL = 'Record unlocks once the speech model is ready.';
export const REASON_CONSENT = 'Read the line above aloud and tick "Everyone here agreed" first.';
export const REASON_LISTEN = 'Listen needs the recording on.';
export const USE_IT_HINT = "Use it: the agent distils the answer from the talk and keeps the whole talk as the question's discussion.";
export const NOT_RECORDING = 'Not recording. The session transcript appears here once Record is on.';
export const LISTENING = 'Recording. The session transcript appears here as it is spoken.';
export const MODEL_HINT =
  'One time on this laptop. The model runs here, so no audio or text leaves the machine for transcription. Type answers work meanwhile.';
export const SOURCE_HINT =
  "Room microphone records the people in this room. Call audio records the virtual meeting's sound playing on this laptop.";
export const SOURCE_LOCKED = 'Turn Record off to change the source.';
/** The recording sources in the prototype's order; the first is the default. */
const SOURCE_CHOICES: ReadonlyArray<{ source: CaptureSource; label: string }> = [
  { source: 'microphone', label: 'Room microphone' },
  { source: 'call', label: 'Call audio' },
];
export const OPEN_ANOTHER = 'Open another grilling agent';
export const HINT_PARALLEL = 'Grills one more ticket in parallel, in this session. Each agent takes a different ticket.';
export const HINT_CHANNELS = 'Each agent receives the transcript only while its own Channel switch is on.';
const TRANSCRIPT_SENT = 'Transcript sent with "use it": the agent takes the answer from it.';
const TRANSCRIPT_FILES = '.txt,.md,.vtt,.srt,text/plain';
/** More slices than this waiting for the speech model, and the panel says transcription is behind. */
export const BEHIND_AFTER_SLICES = 2;
const TAG_COLOURS = 4;
const SECOND_MS = 1000;
const PERCENT = 100;

export interface MeetingPanelOptions {
  agents: MeetingAgents;
  /** The audio capture, made on the first Record: the page's microphone or call audio in the app, a fake in tests. */
  capture: () => AudioCapture;
  now?: () => Date;
}

type Model = { status: 'preparing'; percent: number | null } | { status: 'ready' } | { status: 'failed'; reason: string };

const pad = (value: number) => String(value).padStart(2, '0');
const clock = (at: Date) => `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
const minutes = (at: Date) => `${pad(at.getHours())}:${pad(at.getMinutes())}`;

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / SECOND_MS));
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/** The slices heard that have not been transcribed, found silent or left out yet. */
function slicesWaiting(slices: SliceCounts): number {
  return slices.heard - slices.transcribed - slices.silent - slices.dropped;
}

export function behindText(waiting: number): string {
  return (
    `Transcription is behind: ${waiting} slices (about ${waiting * SLICE_SECONDS} seconds of talk) are waiting for ` +
    'the speech model. They appear here once transcribed; a slice the model takes more than 15 seconds over is ' +
    'left out of the transcript.'
  );
}

function transcriptLines(state: SessionState | null): string[] {
  return (state?.transcript ?? '').split('\n').filter((line) => line.trim() !== '');
}

/** What presence means, in the prototype's words: the domains whose tickets come up. */
function presenceHint(present: readonly Member[]): string {
  if (present.length === 0) return 'Used only to pick tickets: with nobody ticked, the agent picks none. Change it at any time.';
  const domains = [...new Set(present.flatMap((member) => member.domains))];
  const comeUp = domains.length === 0 ? 'only no-domain tickets come up' : `${domains.join(', ')} and no-domain tickets come up`;
  return `Used only to pick tickets: ${comeUp}. Change it at any time.`;
}

/** The one capture of the session and the source it records, shared by every meeting agent's tab, as Record is. */
interface Microphone {
  audio?: AudioCapture;
  source: CaptureSource;
  capturing: boolean;
  since: number | null;
  /** Each mounted panel's redraw, so a source picked in one tab shows in every tab. */
  redraws: Set<() => void>;
  /** Each mounted panel's handler for a capture that stopped by itself, given the reason. */
  ended: Set<(message: string) => void>;
}

export function meetingPanel({ agents, capture, now = () => new Date() }: MeetingPanelOptions): TabPanel {
  // Each tab's panel turns the same capture on and off: one per tab would hear every slice twice and leave a
  // microphone running that no other tab can stop.
  const microphone: Microphone = {
    source: SOURCE_CHOICES[0].source,
    capturing: false,
    since: null,
    redraws: new Set(),
    ended: new Set(),
  };
  return {
    kinds: ['grilling'],
    slot: 'controls',
    priority: MEETING_PANEL_PRIORITY,
    mount(container, { agent, grillo, shell }) {
      const store = createStoreClient(grillo);
      const session = createSessionClient(grillo);
      let project: string | undefined;
      let host: Member | null = null;
      let members: Member[] = [];
      let tickets: Ticket[] = [];
      let state: SessionState | null = null;
      let model: Model = { status: 'preparing', percent: null };
      let ticked = new Set<string>();
      let mode: AgentMode = 'type';
      let greeted = false;
      let waiting = agent.waiting;
      let tabs: readonly AgentInfo[] = [];
      let busy = false;
      let disposed = false;
      let message: { text: string; error: boolean } | null = null;
      let timer: ReturnType<typeof setInterval> | undefined;
      const lineTimes: string[] = [];

      // ---------- The parts, built once and redrawn in place ----------
      const bannerTime = el('span', 'small');
      const banner = el('div', 'rec-banner', [
        el('span', 'sdot'),
        'Recording',
        el('span', 'small', ['· audio and transcription stay on this laptop']),
        el('span', 'spacer'),
        bannerTime,
      ]);
      banner.setAttribute('role', 'status');

      const presentRows = el('div', 'stack');
      const presentHint = el('p', 'small muted');
      const presentCard = el('div', 'card stack', [el('h4', '', ['Present']), presentRows, presentHint]);

      const script = el('p', 'script', [CONSENT_SCRIPT]);
      const consentBox = el('input', '');
      consentBox.type = 'checkbox';
      const consentTicked = el('p', 'small muted');
      const consentCard = el('div', 'card stack', [
        el('h4', '', ['Consent']),
        script,
        el('label', 'check', [consentBox, ` ${CONSENT_LABEL}`]),
        consentTicked,
      ]);

      const record = toggle('Record', { onChange: (on) => void setRecording(on) });
      record.input.classList.add('rec');
      const recordReason = el('p', 'reason');
      const transcriptField = el('textarea', '');
      transcriptField.setAttribute('aria-label', 'Transcript');
      transcriptField.placeholder = 'Paste a transcript of the talk about the question at hand';
      const file = el('input', 'file-input');
      file.type = 'file';
      file.accept = TRANSCRIPT_FILES;
      file.setAttribute('aria-label', 'Transcript file');
      const openImport = button('Import a transcript (paste or upload)', { small: true, onClick: () => showImport(true) });
      const upload = button('Upload transcript file', { small: true, onClick: () => file.click() });
      const cancelImport = button('Cancel', { small: true, onClick: () => showImport(false) });
      const useImport = button('Use it', { small: true, variant: 'primary', onClick: () => void useTranscript() });
      const importer = el('div', 'stack', [
        transcriptField,
        el('div', 'row', [upload, file]),
        el('div', 'row', [el('span', 'spacer'), cancelImport, useImport]),
      ]);
      const opener = el('div', 'row', [openImport]);
      const sourceButtons = SOURCE_CHOICES.map(({ source, label }) => {
        const choice = el('button', '', [label]);
        choice.type = 'button';
        choice.addEventListener('click', () => pickSource(source));
        return choice;
      });
      const sourceChoice = el('div', 'seg', sourceButtons);
      sourceChoice.setAttribute('role', 'group');
      sourceChoice.setAttribute('aria-label', 'Recording source');
      const sourceHint = el('p', 'small muted', [SOURCE_HINT]);
      const recordingCard = el('div', 'card stack', [
        el('h4', '', ['Recording']),
        sourceChoice,
        sourceHint,
        record.root,
        recordReason,
        opener,
        importer,
      ]);
      const agentRows = el('ul', 'rows small');
      const openAnother = button(OPEN_ANOTHER, { small: true, onClick: () => void openAnotherAgent() });
      const agentsHint = el('p', 'small muted');
      const agentsCard = el('div', 'card stack', [el('h4', '', ['Grilling agents']), agentRows, openAnother, agentsHint]);
      const side = el('div', 'stack meeting-side', [presentCard, consentCard, recordingCard]);

      const modelBadge = el('span', 'row');
      const modelText = el('span', 'strong');
      const modelProgress = el('progress', 'progress');
      modelProgress.max = PERCENT;
      modelProgress.setAttribute('aria-label', 'Speech model download');
      const retryRow = el('div', 'row', [button('Try again', { small: true, onClick: () => prepareModel() })]);
      const modelCard = el('div', 'card stack', [
        el('div', 'row', [modelBadge, modelText]),
        modelProgress,
        el('p', 'small muted', [MODEL_HINT]),
        retryRow,
      ]);
      modelCard.setAttribute('role', 'status');

      const listen = el('button', '', ['Listen']);
      const type = el('button', '', ['Type']);
      for (const [choice, picks] of [
        [listen, 'listen'],
        [type, 'type'],
      ] as const) {
        choice.type = 'button';
        choice.addEventListener('click', () => void pickMode(picks));
      }
      const seg = el('div', 'seg', [listen, type]);
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Answer mode');
      const useIt = button('Use it', { variant: 'primary', onClick: () => void act(() => session.useIt(agent.id)) });
      const skip = button('Skip question', { onClick: () => void act(() => session.skip(agent.id)) });
      const jump = el('select', 'w-auto');
      jump.setAttribute('aria-label', 'Jump to ticket');
      jump.addEventListener('change', () => {
        const ticket = Number(jump.value);
        jump.value = '';
        if (Number.isInteger(ticket) && ticket > 0) void act(() => session.jump(agent.id, ticket));
      });
      const questionHint = el('p', '');
      const questionCard = el('div', 'card stack', [el('div', 'row', [seg, useIt, skip, jump]), questionHint]);
      const messages = el('div', 'stack');
      const head = el('div', 'stack meeting-head', [modelCard, messages, questionCard]);

      const transcript = el('div', 'transcript');
      transcript.setAttribute('aria-label', 'Session transcript');
      const behind = note('', 'warn');
      behind.setAttribute('role', 'status');
      const foot = el('div', 'meeting-foot stack', [behind, transcript]);

      const root = el('div', 'meeting meeting-panel', [banner, side, head, foot]);
      root.hidden = true;
      container.append(root);
      microphone.redraws.add(draw);
      microphone.ended.add(captureEnded);
      showImport(false);

      // ---------- Drawing ----------
      function drawPresent(): void {
        const declared = [...new Set(members.flatMap((member) => member.domains))];
        presentRows.replaceChildren(
          ...members.map((member) => {
            const box = el('input', '');
            box.type = 'checkbox';
            box.checked = ticked.has(member.login);
            box.disabled = busy;
            box.addEventListener('change', () => void tick(member.login, box.checked));
            const name = member.name ? `${member.login} · ${member.name}` : member.login;
            const tags = member.domains.map((domain) =>
              el('span', `tag d${(declared.indexOf(domain) % TAG_COLOURS) + 1}`, [domain]),
            );
            const isHost = host !== null && member.login.toLowerCase() === host.login.toLowerCase();
            return el('label', 'check', [box, ` ${name} `, ...tags, ...(isHost ? [badge('Host', 'info')] : [])]);
          }),
        );
        presentHint.textContent = presenceHint(members.filter((member) => ticked.has(member.login)));
      }

      function drawModel(): void {
        modelCard.hidden = model.status === 'ready';
        retryRow.hidden = model.status !== 'failed';
        modelProgress.hidden = model.status !== 'preparing';
        if (model.status === 'preparing') {
          modelBadge.replaceChildren(badge('Preparing', 'warn'));
          modelText.textContent =
            model.percent === null ? 'Preparing speech model' : `Preparing speech model (downloading, ${model.percent}%)`;
          if (model.percent === null) {
            modelProgress.removeAttribute('value');
            modelProgress.textContent = '';
          } else {
            modelProgress.value = model.percent;
            modelProgress.textContent = `${model.percent}%`;
          }
        } else if (model.status === 'failed') {
          modelBadge.replaceChildren(badge('Not ready', 'err'));
          modelText.textContent = `The speech model could not be prepared: ${model.reason}`;
        }
      }

      function drawBannerTime(): void {
        bannerTime.textContent = microphone.since === null ? '' : elapsed(now().getTime() - microphone.since);
      }

      function drawTickets(): void {
        const pick = el('option', '', ['Jump to ticket…']);
        pick.value = '';
        jump.replaceChildren(
          pick,
          ...tickets.map((ticket) => {
            const option = el('option', '', [ticket.title]);
            option.value = String(ticket.id.number);
            return option;
          }),
        );
      }

      function drawTranscript(): void {
        const lines = transcriptLines(state);
        const added = lines.length > lineTimes.length;
        while (lineTimes.length < lines.length) lineTimes.push(clock(now()));
        if (lines.length === 0) {
          transcript.replaceChildren(el('p', 'muted', [state?.recording ? LISTENING : NOT_RECORDING]));
          return;
        }
        transcript.replaceChildren(
          ...lines.map((line, at) => el('p', '', [el('span', 'muted', [lineTimes[at]]), ` ${line}`])),
        );
        // Only a new line scrolls the strip, so a member reading back up is left where they are.
        if (added) transcript.scrollTop = transcript.scrollHeight;
      }

      /**
       * This session's grilling agents in tab order, each with its channel; this agent's row is selected. Shown once
       * consent is ticked, as the prototype shows it only in a session under way.
       */
      function drawAgents(): void {
        if ((state?.consent ?? null) === null) agentsCard.remove();
        else if (agentsCard.parentElement !== side) side.append(agentsCard);
        const ours = tabs.filter((tab) => project !== undefined && agents.projectOf(tab.id) === project);
        const open = new Set(state?.channels ?? []);
        agentRows.replaceChildren(
          ...ours.map((tab) => {
            const isOpen = open.has(tab.id);
            const isNew = agents.isExtra(tab.id) && !isOpen;
            const name = el('span', '', [tab.title, ...(isNew ? [' ', badge('New', 'info')] : [])]);
            const channel = isOpen ? badge('Channel open', 'ok') : badge('Channel closed');
            return el('li', tab.id === agent.id ? 'selected' : '', [name, channel]);
          }),
        );
        openAnother.disabled = busy || state === null;
        const someClosed = ours.length > 1 && ours.some((tab) => !open.has(tab.id));
        agentsHint.textContent = someClosed ? HINT_CHANNELS : HINT_PARALLEL;
      }

      function draw(): void {
        if (disposed) return;
        const recording = state?.recording === true;
        const consent = state?.consent ?? null;
        const ready = model.status === 'ready';

        banner.hidden = !recording;
        if (recording) timer ??= setInterval(drawBannerTime, SECOND_MS);
        else stopTimer();
        drawBannerTime();

        for (const box of presentRows.querySelectorAll('input')) box.disabled = busy || state === null;
        script.hidden = consent !== null;
        consentBox.checked = consent !== null;
        consentBox.disabled = busy || consent !== null || state === null || host === null;
        consentTicked.hidden = consent === null;
        consentTicked.textContent = consent ? `Ticked by ${consent.by} at ${minutes(new Date(consent.at))}.` : '';

        for (const [at, choice] of sourceButtons.entries()) {
          choice.setAttribute('aria-pressed', String(SOURCE_CHOICES[at].source === microphone.source));
          choice.disabled = busy || recording;
        }
        sourceHint.hidden = recording || !ready;
        record.input.checked = recording;
        record.input.disabled = busy || state === null || (!recording && (!ready || consent === null));
        const reason = recording ? SOURCE_LOCKED : !ready ? REASON_MODEL : consent === null ? REASON_CONSENT : '';
        recordReason.textContent = reason;
        recordReason.hidden = reason === '';

        const blank = transcriptField.value.trim() === '';
        openImport.disabled = busy;
        transcriptField.disabled = busy;
        upload.disabled = busy;
        cancelImport.disabled = busy;
        useImport.disabled = busy || blank;

        drawModel();

        listen.setAttribute('aria-pressed', String(mode === 'listen'));
        type.setAttribute('aria-pressed', String(mode === 'type'));
        listen.disabled = busy || !recording;
        type.disabled = busy;
        useIt.disabled = busy || mode !== 'listen' || !recording;
        skip.disabled = busy;
        jump.disabled = busy;
        questionHint.className = recording ? 'small muted' : 'reason';
        questionHint.textContent = recording ? (mode === 'listen' ? USE_IT_HINT : '') : REASON_LISTEN;
        questionHint.hidden = questionHint.textContent === '';

        messages.replaceChildren(...(message ? [note(message.text, message.error ? 'err' : 'ok')] : []));
        const waiting = recording && state ? slicesWaiting(state.slices) : 0;
        behind.hidden = waiting <= BEHIND_AFTER_SLICES;
        behind.textContent = behind.hidden ? '' : behindText(waiting);
        drawTranscript();
        drawAgents();
      }

      // ---------- Acting ----------
      async function act(work: () => Promise<unknown>, done?: string): Promise<void> {
        if (busy) return;
        busy = true;
        message = null;
        draw();
        try {
          await work();
          if (done) message = { text: done, error: false };
        } catch (error) {
          message = { text: messageOf(error), error: true };
        } finally {
          busy = false;
          draw();
        }
      }

      function presentLogins(): string[] {
        return members.filter((member) => ticked.has(member.login)).map((member) => member.login);
      }

      function tick(login: string, present: boolean): Promise<void> {
        const before = new Set(ticked);
        if (present) ticked.add(login);
        else ticked.delete(login);
        drawPresent();
        return act(async () => {
          try {
            await session.setPresent(presentLogins());
          } catch (error) {
            ticked = before;
            drawPresent();
            throw error;
          }
          if (greeted) await session.typePresent(agent.id, presentLogins());
        });
      }

      function audioCapture(): AudioCapture {
        if (microphone.audio === undefined) {
          microphone.audio = capture();
          // The one capture stopped by itself (the microphone unplugged): the session stops recording, once.
          microphone.audio.onEnded((why) => {
            microphone.capturing = false;
            microphone.since = null;
            for (const handler of [...microphone.ended]) handler(why);
            // A last transcript write that fails is said too, as when Record is turned off by hand.
            session.setRecording(false).catch((error: unknown) => {
              for (const handler of [...microphone.ended]) handler(`${why} ${messageOf(error)}`);
            });
          });
        }
        return microphone.audio;
      }

      /** Record went off by itself: this tab says why, and Listen falls back to Type as when Record is turned off. */
      function captureEnded(why: string): void {
        message = { text: why, error: true };
        stopTimer();
        draw();
        if (mode !== 'listen') return;
        mode = 'type';
        session.typeMode(agent.id, 'type').catch((error: unknown) => {
          message = { text: messageOf(error), error: true };
          draw();
        });
      }

      function stopTimer(): void {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
      }

      function setRecording(on: boolean): Promise<void> {
        return act(async () => {
          if (on) {
            await session.setRecording(true);
            const started = await audioCapture().startCapture({ source: microphone.source });
            if (!started.ok) {
              await session.setRecording(false);
              throw new Error(started.message);
            }
            microphone.capturing = true;
            microphone.since = now().getTime();
            return;
          }
          await stopRecording();
          if (mode === 'listen') {
            mode = 'type';
            await session.typeMode(agent.id, 'type');
          }
        });
      }

      async function stopRecording(): Promise<void> {
        try {
          if (microphone.capturing) await audioCapture().stopCapture();
        } finally {
          microphone.capturing = false;
          microphone.since = null;
          stopTimer();
          await session.setRecording(false);
        }
      }

      /** The source the next Record captures; refused while recording, as the capture cannot change source mid-way. */
      function pickSource(picked: CaptureSource): void {
        if (busy || state?.recording === true || microphone.capturing || picked === microphone.source) return;
        microphone.source = picked;
        for (const redraw of microphone.redraws) redraw();
      }

      function pickMode(picked: AgentMode): Promise<void> {
        if (picked === mode) return Promise.resolve();
        return act(async () => {
          // Listen needs the transcript in this agent's box, so its channel opens with it.
          if (picked === 'listen') await session.setChannel(agent.id, true);
          await session.typeMode(agent.id, picked);
          mode = picked;
        });
      }

      function showImport(open: boolean): void {
        importer.hidden = !open;
        opener.hidden = open;
        if (!open) transcriptField.value = '';
        draw();
      }

      /** One more grilling agent in this session, in its own tab: it joins the running session and claims its own ticket. */
      function openAnotherAgent(): Promise<void> {
        return act(async () => {
          if (project === undefined) return;
          const agentId = await startMeetingAgent(grillo, agents, { project, folder: agent.folder, extra: true });
          shell.navigate(AGENT_SCREEN, { agentId });
        });
      }

      function useTranscript(): Promise<void> {
        return act(async () => {
          await sendUseIt(grillo, agent.id, transcriptField.value);
          showImport(false);
        }, TRANSCRIPT_SENT);
      }

      transcriptField.addEventListener('input', draw);
      consentBox.addEventListener('change', () => {
        if (!consentBox.checked || host === null) return;
        const login = host.login;
        void act(() => session.tickConsent(login));
      });
      file.addEventListener('change', () => {
        const chosen = file.files?.[0];
        file.value = '';
        if (!chosen) return;
        chosen.text().then(
          (text) => {
            transcriptField.value = text;
            draw();
          },
          (error: unknown) => {
            message = { text: `Grillo could not read ${chosen.name}: ${messageOf(error)}`, error: true };
            draw();
          },
        );
      });

      // ---------- Starting ----------
      function prepareModel(): void {
        model = { status: 'preparing', percent: null };
        draw();
        const stop = grillo.on('transcription:model-progress', ({ receivedBytes, totalBytes }) => {
          if (model.status !== 'preparing' || !(totalBytes > 0)) return;
          model = { status: 'preparing', percent: Math.min(PERCENT, Math.floor((receivedBytes * PERCENT) / totalBytes)) };
          draw();
        });
        grillo.invoke('transcription:ensure-model', undefined).then(
          () => {
            model = { status: 'ready' };
          },
          (error: unknown) => {
            model = { status: 'failed', reason: messageOf(error) };
          },
        ).finally(() => {
          stop();
          draw();
        });
      }

      /**
       * Once the agent has said it is ready, it hears the session file (every meeting agent, channel open or not:
       * `resources/skills/README.md`, Session row), who is present and the mode the screen shows.
       */
      async function greet(): Promise<void> {
        if (greeted || !waiting || state === null || host === null) return;
        greeted = true;
        try {
          await session.tellSession(agent.id);
          await session.typePresent(agent.id, presentLogins());
          await session.typeMode(agent.id, mode);
        } catch (error) {
          message = { text: messageOf(error), error: true };
          draw();
        }
      }

      async function load(of: string): Promise<void> {
        try {
          const [me, list, open] = await Promise.all([
            store.currentMember(of),
            store.listMembers(of),
            store.listTickets(of, { state: 'open' }),
          ]);
          host = me;
          members = list;
          tickets = open;
          let running = await session.state();
          if (running === null) running = await session.startSession(of);
          else if (running.project !== of) {
            throw new Error(`A live session of ${running.project} is already running on this laptop.`);
          }
          state = running;
          ticked = new Set(running.present.length > 0 ? running.present : [me.login]);
          if (running.present.length === 0) await session.setPresent(presentLogins());
        } catch (error) {
          message = { text: messageOf(error), error: true };
        }
        drawPresent();
        drawTickets();
        draw();
        await greet();
      }

      function activate(): void {
        if (project !== undefined) return;
        project = agents.projectOf(agent.id);
        if (project === undefined) return;
        root.hidden = false;
        draw();
        prepareModel();
        void load(project);
      }

      const stopSession = grillo.on('session:changed', (changed) => {
        if (project === undefined || (changed !== null && changed.project !== project)) return;
        state = changed;
        draw();
      });
      const stopAgents = agents.onChange(() => {
        activate();
        draw();
      });
      const stopTabs = shell.onAgentTabs((list: readonly AgentInfo[]) => {
        tabs = list.filter((candidate): candidate is AgentInfo => typeof candidate?.id === 'string');
        waiting = tabs.find((candidate) => candidate.id === agent.id)?.waiting === true;
        draw();
        void greet();
      });
      activate();

      return {
        dispose() {
          disposed = true;
          microphone.redraws.delete(draw);
          microphone.ended.delete(captureEnded);
          stopSession();
          stopAgents();
          stopTabs();
          stopTimer();
          if (project === undefined) return;
          agents.forget(agent.id);
          // The last meeting agent has gone: the session ends, its transcript file saved.
          if (agents.count() === 0) {
            const ending = microphone.capturing ? audioCapture().stopCapture().catch(() => undefined) : Promise.resolve();
            microphone.capturing = false;
            microphone.since = null;
            void ending.then(() => session.endSession()).catch(() => undefined);
          }
        },
      };
    },
  };
}
