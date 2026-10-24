// Runs after every `npm install` / `npm ci` (the `postinstall` script).
//
// node-pty 1.1.0 ships its macOS `spawn-helper` prebuilds without the execute bit, so on a Mac every
// terminal fails to start with "posix_spawnp failed". This restores the bit. Harmless elsewhere:
// on Windows the files are not used and chmod changes nothing that matters.
const fs = require('node:fs');
const path = require('node:path');

const EXECUTABLE = 0o755;
const MAC_PREBUILDS = ['darwin-arm64', 'darwin-x64'];

const nodePtyFolder = path.dirname(require.resolve('node-pty/package.json'));

for (const prebuild of MAC_PREBUILDS) {
  const spawnHelper = path.join(nodePtyFolder, 'prebuilds', prebuild, 'spawn-helper');
  if (fs.existsSync(spawnHelper)) {
    fs.chmodSync(spawnHelper, EXECUTABLE);
  }
}
