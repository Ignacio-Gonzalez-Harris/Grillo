// Run with Electron as Node (ELECTRON_RUN_AS_NODE=1): loads the whisper.cpp binding inside Electron's runtime
// and prints what it found as JSON. No model is needed: this proves the native module loads on this system.
const { loadWhisperModule } = require('@fugood/whisper.node');

loadWhisperModule().then(
  (binding) => {
    process.stdout.write(
      JSON.stringify({ electron: process.versions.electron, hasWhisperContext: typeof binding.WhisperContext === 'function' }),
    );
    process.exit(0);
  },
  (error) => {
    process.stderr.write(String(error));
    process.exit(1);
  },
);
