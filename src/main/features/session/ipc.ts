import { app } from 'electron';
import type { FeatureContext } from '../../app/features';
import { appAgentRuntime } from '../agents/ipc';
import { audioSlices } from '../audio/slices';
import { appStore } from '../store/ipc';
import { speechModelPathIn } from '../transcription/model';
import { createTranscriber } from '../transcription/transcriber';
import { createWhisperEngine } from '../transcription/whisper-engine';
import { announcingTranscriber, registerSessionChannels } from './channels';
import { createSessionHost, type SessionHost } from './session';

/**
 * The live grilling session on IPC: the app's one store, the captured slices, whisper.cpp with the speech model the
 * transcription feature prepares, and the agent runtime the session types or sends into.
 */
export function register({ ipc, settings }: FeatureContext): void {
  const engine = createWhisperEngine({ modelPath: speechModelPathIn(app.getPath('userData')) });
  // The transcriber announces the host's changes, so `changed` reads the host when a slice is done, never before.
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
    },
    held: (agentId, text) => ipc.send('session:held', { agentId, text }),
  });
  registerSessionChannels(ipc, host);
}
