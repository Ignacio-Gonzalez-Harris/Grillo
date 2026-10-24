// Run with Electron as Node (ELECTRON_RUN_AS_NODE=1): loads node-pty inside Electron's runtime,
// runs one shell command in a pseudo-terminal and prints what it saw as JSON.
const pty = require('node-pty');

const MARKER = 'grillo-pty-ok';
const isWindows = process.platform === 'win32';
const shell = isWindows ? 'cmd.exe' : '/bin/sh';
const args = isWindows ? ['/c', `echo ${MARKER}`] : ['-c', `echo ${MARKER}`];

const terminal = pty.spawn(shell, args, { cols: 80, rows: 24 });
let output = '';
terminal.onData((data) => {
  output += data;
});
terminal.onExit(({ exitCode }) => {
  process.stdout.write(
    JSON.stringify({ electron: process.versions.electron, exitCode, sawMarker: output.includes(MARKER) }),
  );
  process.exit(0);
});
