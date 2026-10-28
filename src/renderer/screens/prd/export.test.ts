import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrdVersion } from '../../../main/store/github/repo/records';
import { htmlExport, markdownExport } from './export';

// The PRD writer's made-up fixture: a stored version file exactly as the store writes it.
const STORED_FILE = '.grillo/prd/v1.md';
const stored = readFileSync(resolve('resources/skills/grillo-prd/fixtures/after-feedback', STORED_FILE), 'utf8').replace(/\r\n/g, '\n');
const version = parsePrdVersion(stored, STORED_FILE);
const PROJECT = 'example-org/sample-project-1';

describe('markdownExport', () => {
  it('is the stored file, byte for byte, named after the project and the version', () => {
    expect(markdownExport(PROJECT, version)).toEqual({ name: 'sample-project-1-prd-v1.md', type: 'text/markdown', content: stored });
  });
});

describe('htmlExport', () => {
  const file = htmlExport(PROJECT, version);

  it('is one HTML file named after the project and the version', () => {
    expect(file.name).toBe('sample-project-1-prd-v1.html');
    expect(file.type).toBe('text/html');
    expect(file.content.startsWith('<!doctype html>')).toBe(true);
    expect(file.content).toContain('<title>PRD · version 1</title>');
  });

  it('holds everything it shows: no script, no stylesheet link, no image, frame or font to fetch', () => {
    expect(file.content).not.toMatch(/<script|<link|<img|<iframe|\ssrc=|url\(|@import/i);
  });

  it('inlines the liquid glass tokens and the document style', () => {
    const style = /<style>([\s\S]*)<\/style>/.exec(file.content)?.[1] ?? '';
    expect(style).toContain('--color-accent:');
    expect(style).toContain('--space-4:');
    expect(style).toContain('.prd-doc .code-chip');
    expect(file.content).toContain('<body class="prd-export">');
  });

  it('carries the body with its trace codes linked to the audit appendix, and the unsourced list', () => {
    expect(file.content).toContain('<a href="#code-S2">S2</a>');
    expect(file.content).toContain('id="code-S2"');
    expect(file.content).toContain('<span class="code-chip nosrc">[no source]</span>');
    expect(file.content).toContain('<section class="appendix">');
    expect(file.content).toContain('Unsourced');
  });

  it('names the project, the version and its day at the top', () => {
    expect(file.content).toContain(`<p class="prd-doc-meta">${PROJECT} · PRD · version 1 · ${version.date.slice(0, 10)}</p>`);
  });
});
