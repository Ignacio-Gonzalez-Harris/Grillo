import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createSpawnChatProcess, type SpawnChild } from './spawn-process';

/** A stand-in for a Node child process: piped stdin, stdout and stderr, and the `exit` and `close` events. */
class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function setup(platform: NodeJS.Platform = 'linux') {
  const child = new FakeChild();
  const spawnChild: SpawnChild = () => child as never;
  const process = createSpawnChatProcess(spawnChild, platform)('/opt/made-up/bin/claude', ['-p'], {
    cwd: '/home/made-up/demo-project',
    env: {},
  });
  const seen: string[] = [];
  process.onStdout((chunk) => seen.push(`out:${chunk}`));
  process.onStderr((chunk) => seen.push(`err:${chunk}`));
  process.onExit((exitCode) => seen.push(`exit:${exitCode}`));
  return { child, process, seen };
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('spawning the claude process', () => {
  it('still delivers a last stdout line that arrives after the process exited, and reports the end once after it', async () => {
    const { child, seen } = setup();

    child.emit('exit', 0, null);
    child.stdout.end('{"type":"result"}\n');
    await settle();
    child.emit('close', 0, null);
    child.emit('error', new Error('late'));

    expect(seen).toEqual(['out:{"type":"result"}\n', 'exit:0']);
  });

  it('reports a process that could not start as an end with no exit code, its reason as error text', () => {
    const { child, seen } = setup();

    child.emit('error', new Error('spawn claude ENOENT'));
    child.emit('close', -2, null);

    expect(seen).toEqual(['err:spawn claude ENOENT\n', 'exit:null']);
  });

  it('pipes its error text, as text, and reports it before the end', async () => {
    const { child, seen } = setup();

    child.stderr.end(Buffer.from('Error: made-up failure é\n', 'utf8'));
    await settle();
    child.emit('close', 1, null);

    expect(seen).toEqual(['err:Error: made-up failure é\n', 'exit:1']);
  });

  it('runs a Windows .cmd shim through the shell with its path quoted, and an executable directly', () => {
    const calls: string[] = [];
    const record: SpawnChild = (file, _args, options) => {
      calls.push(`${file} shell=${String(options.shell)}`);
      return new FakeChild() as never;
    };

    createSpawnChatProcess(record, 'win32')('C:\\Program Files\\made-up\\claude.cmd', ['-p'], { cwd: 'C:\\p', env: {} });
    createSpawnChatProcess(record, 'win32')('C:\\made-up\\claude.exe', ['-p'], { cwd: 'C:\\p', env: {} });

    expect(calls).toEqual(['"C:\\Program Files\\made-up\\claude.cmd" shell=true', 'C:\\made-up\\claude.exe shell=false']);
  });

  it('writes to stdin, and on stop closes stdin and kills the process', () => {
    const { child, process } = setup();
    const written: string[] = [];
    child.stdin.on('data', (data: Buffer) => written.push(data.toString('utf8')));

    process.write('{"type":"user"}\n');
    process.stop();

    expect(written).toEqual(['{"type":"user"}\n']);
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.killed).toBe(true);
  });
});
