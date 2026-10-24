import { join } from 'node:path';

/**
 * The speech model: whisper.cpp's `base.en`, downloaded on first use from its public home on Hugging Face
 * (PRD section 8, Speech-to-text). This file imports nothing from Electron, so build and test config can use it.
 */
export const MODEL_FILE_NAME = 'ggml-base.en.bin';
export const MODEL_REPOSITORY = 'ggerganov/whisper.cpp';

/** Where one model file comes from and how to recognise it. Its SHA-256 doubles as its version. */
export interface ModelDescriptor {
  url: string;
  sha256: string;
  sizeBytes: number;
}

/** A file URL pinned to one commit of the model repository, so the bytes behind it never change. */
export function modelDownloadUrl(commit: string): string {
  return `https://huggingface.co/${MODEL_REPOSITORY}/resolve/${commit}/${MODEL_FILE_NAME}`;
}

/** The model this version of Grillo ships knowing; an update replaces it with whatever is published later. */
export const PINNED_MODEL: ModelDescriptor = {
  url: modelDownloadUrl('5359861c739e955e79d9a303bcbc70fb988958b1'),
  sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
  sizeBytes: 147_964_211,
};

/** The one error a failed or corrupt model download becomes. */
export class ModelDownloadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelDownloadError';
  }
}

/** The models folder inside the app data folder (`app.getPath('userData')`). */
export function modelFolderIn(userDataFolder: string): string {
  return join(userDataFolder, 'models');
}

/** The model file inside the app data folder. */
export function speechModelPathIn(userDataFolder: string): string {
  return join(modelFolderIn(userDataFolder), MODEL_FILE_NAME);
}

/**
 * Electron's app data folder for Grillo, worked out without Electron (the test config needs it to find a model
 * downloaded by the app). It matches `app.getPath('userData')`: the system's app data folder plus the product name.
 */
export function defaultUserDataFolder({
  platform,
  env,
  homeFolder,
}: {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homeFolder: string;
}): string {
  const productName = 'Grillo';
  if (platform === 'win32') {
    return join(env['APPDATA'] ?? join(homeFolder, 'AppData', 'Roaming'), productName);
  }
  if (platform === 'darwin') {
    return join(homeFolder, 'Library', 'Application Support', productName);
  }
  return join(env['XDG_CONFIG_HOME'] ?? join(homeFolder, '.config'), productName);
}
