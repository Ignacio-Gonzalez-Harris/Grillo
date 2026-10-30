import { app } from 'electron';
import type { FeatureContext } from '../../app/features';
import { appAgentRuntime, observeAgentList } from '../agents/ipc';
import { audioSlices } from '../audio/slices';
import { appStore } from '../store/ipc';
import { speechModelPathIn } from '../transcription/model';
import { createTranscriber } from '../transcription/transcriber';
import { createWhisperEngine } from '../transcription/whisper-engine';
import { announcingTranscriber, registerSessionChannels } from './channels';
import { readTicketHolds, releaseHoldsOf, releasingHoldsOfStoppedTabs } from './holds';
import { createSessionHost, type SessionHost } from './session';

/**
 * The live grilling session on IPC: the app's one store, the captured slices, whisper.cpp with the speech model the
 * transcription feature prepares, and the agent runtime the session types or sends into. A tab that stops has its
 * ticket holds let go of.
 */
export function register({ ipc, settings }: FeatureContext): void {
  const engine = createWhisperEngine({ modelPath: speechModelPathIn(app.getPath('userData')) });
  // The transcriber announces the host's changes, so `changed` reads the host when a slice is done, never before.
  // A slice arriving announces too, so the meeting panel sees slices waiting to be transcribed.
  const changed = () => ipc.send('session:changed', host.state());
  const host: SessionHost = createSessionHost({
    store: appStore(settings),
    slices: audioSlices,
    transcriber: announcingTranscriber(createTranscriber(engine), changed),
    agents: {
      get choice() {
        return appAgentRuntime().choice;
      },
      write: (id, text) => appAgentRuntime().write(id, text),
      send: (id, text) => appAgentRuntime().send(id, text),
      list: () => appAgentRuntime().list(),
      ready: (id) => appAgentRuntime().ready(id),
    },
    held: (agentId, text, sent) => ipc.send('session:held', { agentId, text, sent }),
    sliceHeard: changed,
    holds: readTicketHolds,
  });
  registerSessionChannels(ipc, host);
  // A tab that stops mid-ticket never lets go of its hold itself, so the ticket would stay out of reach of every other
  // grilling agent on this laptop: Grillo lets go of it.
  observeAgentList(releasingHoldsOfStoppedTabs(releaseHoldsOf, console.warn));
}
