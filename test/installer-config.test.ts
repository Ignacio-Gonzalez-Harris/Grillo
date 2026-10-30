import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { minimatch } from 'minimatch';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// electron-builder only runs when a version is published, so these tests check what electron-builder.yml tells it to
// do: which files the installers leave out, that nothing is compiled from source, and which Macs the Mac build runs on.

interface Target {
  target: string;
  arch?: string[];
}

interface BuilderConfig {
  files: string[];
  npmRebuild?: boolean;
  mac: { target: Target[]; x64ArchFiles?: string };
}

const ROOT = join(__dirname, '..');
const builder = parse(readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')) as BuilderConfig;

/**
 * Whether the installer ships a file, the way electron-builder decides: it adds the production dependencies under
 * node_modules by itself, then the `files` list is read in order and the last matching rule wins.
 */
function shipped(file: string): boolean {
  let kept = file.startsWith('node_modules/');
  for (const rule of builder.files) {
    const excluded = rule.startsWith('!');
    if (minimatch(file, excluded ? rule.slice(1) : rule, { dot: true })) kept = !excluded;
  }
  return kept;
}

describe('installer contents', () => {
  it('ships the app and the speech engine each system loads', () => {
    for (const file of [
      'out/main/index.js',
      'package.json',
      'node_modules/@fugood/whisper.node/lib/index.js',
      'node_modules/@fugood/node-whisper-win32-x64/index.node',
      'node_modules/@fugood/node-whisper-darwin-arm64/index.node',
      'node_modules/@fugood/node-whisper-darwin-x64/index.node',
      'node_modules/node-pty/prebuilds/win32-x64/pty.node',
    ]) {
      expect(shipped(file), file).toBe(true);
    }
  });

  it('leaves out the speech-engine variants the app never loads (graphics-card and browser builds)', () => {
    for (const file of [
      'node_modules/@fugood/node-whisper-win32-x64-cuda/index.node',
      'node_modules/@fugood/node-whisper-win32-x64-vulkan/index.node',
      'node_modules/@fugood/node-whisper-wasm/dist/whisper.wasm',
    ]) {
      expect(shipped(file), file).toBe(false);
    }
  });

  it('never compiles native modules from source while packaging: their prebuilt binaries load in Electron', () => {
    expect(builder.npmRebuild).toBe(false);
  });
});

describe('Mac build', () => {
  it('builds one universal app, so the disk image and the update zip run on Apple silicon and Intel Macs', () => {
    expect(builder.mac.target).toEqual([
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] },
    ]);
  });

  it('lets the single-chip native binaries through the universal merge', () => {
    const app = 'Contents/Resources/app.asar.unpacked/node_modules';
    for (const file of [
      `${app}/node-pty/prebuilds/darwin-arm64/pty.node`,
      `${app}/node-pty/prebuilds/darwin-x64/spawn-helper`,
      `${app}/@fugood/node-whisper-darwin-arm64/index.node`,
      `${app}/@fugood/node-whisper-darwin-x64/index.node`,
    ]) {
      // The same options @electron/universal uses when it checks a file that is identical in both builds.
      expect(minimatch(file, builder.mac.x64ArchFiles ?? '', { matchBase: true }), file).toBe(true);
    }
  });
});

describe('Node version', () => {
  it('pins the same Node 24 release in .nvmrc and in package.json engines', () => {
    const nvmrc = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
    const engines = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { engines: { node: string } })
      .engines.node;

    expect(nvmrc).toMatch(/^24\.\d+\.\d+$/);
    expect(engines).toBe(nvmrc);
  });
});
