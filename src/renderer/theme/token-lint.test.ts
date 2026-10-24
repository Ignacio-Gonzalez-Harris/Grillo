import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLiteralValues, lintRendererFolder } from './token-lint';

const RENDERER_FOLDER = resolve(__dirname, '..');

describe('token lint: every colour and spacing value in src/renderer/ is a var(--...) token', () => {
  it('finds no literal colour or spacing value anywhere in src/renderer/ outside the token file', () => {
    expect(lintRendererFolder(RENDERER_FOLDER)).toEqual([]);
  });

  it('keeps theme/tokens.css an exact copy of the UX prototype token file', () => {
    const prototype = readFileSync(resolve(RENDERER_FOLDER, '../../docs/ux/prototypes/grillo/tokens.css'), 'utf8');
    const copy = readFileSync(resolve(RENDERER_FOLDER, 'theme/tokens.css'), 'utf8');

    expect(copy).toBe(prototype);
  });

  it.each([
    ['a hex colour', '.a { color: #fff; }', 'colour', '#fff'],
    ['a hex colour with alpha', '.a { color: #1b2233aa; }', 'colour', '#1b2233aa'],
    ['an rgba() colour', '.a { background: rgba(0, 0, 0, 0.5); }', 'colour', 'rgba('],
    ['an hsl() colour', '.a { color: hsl(10 20% 30%); }', 'colour', 'hsl('],
    ['a named colour', '.a { border-color: white; }', 'colour', 'white'],
    ['a pixel spacing', '.a { padding: 4px; }', 'spacing', '4px'],
    ['a rem spacing beside a token', '.a { margin: var(--space-1) 1rem; }', 'spacing', '1rem'],
    ['a fractional em spacing', '.a { gap: .5em; }', 'spacing', '.5em'],
    ['an invented custom property', '.a { --my-gap: 6px; }', 'spacing', '6px'],
    ['a pixel blur', '.a { backdrop-filter: blur(4px); }', 'spacing', '4px'],
  ])('flags %s', (_case, css, kind, value) => {
    expect(findLiteralValues(css, 'sample.css')).toEqual([{ file: 'sample.css', line: 1, kind, value }]);
  });

  it.each([
    ['a colour token', '.a { color: var(--color-text); }'],
    ['zero', '.a { margin: 0; padding: 0 var(--space-4); }'],
    ['percent and viewport sizes', '.a { width: 100%; min-height: 100vh; }'],
    ['unitless numbers', '.a { line-height: 1.45; flex: 1; }'],
    ['colour keywords', '.a { border: var(--border-width) solid transparent; color: currentColor; background: none; }'],
    ['a media query condition', '@media (max-width: 760px) { .a { display: none; } }'],
    ['a quoted font name and a comment', '.a { font-family: "Segoe UI"; } /* red 4px #fff */'],
    ['grid fractions', '.a { grid-template-columns: minmax(0, 1fr); }'],
    ['a selector with a pseudo-class', '.a:hover, .b:focus-visible { outline: var(--focus-ring-width) solid var(--color-focus-ring); }'],
  ])('accepts %s', (_case, css) => {
    expect(findLiteralValues(css, 'sample.css')).toEqual([]);
  });

  it('reads the style blocks and style attributes of an HTML file, with their line numbers', () => {
    const html = ['<html><head><style>', '.a { color: red; }', '</style></head>', '<body style="padding: 2px">'].join(
      '\n',
    );

    expect(findLiteralValues(html, 'page.html')).toEqual([
      { file: 'page.html', line: 2, kind: 'colour', value: 'red' },
      { file: 'page.html', line: 4, kind: 'spacing', value: '2px' },
    ]);
  });

  it('reads the inline styles a TypeScript file sets', () => {
    const source = [
      "el.style.color = '#abc';",
      "el.style.setProperty('padding', '3px');",
      "el.style.cssText = 'margin: 1em';",
      "el.setAttribute('style', 'margin: 5px');",
      "const selector = '#add';",
    ].join('\n');

    expect(findLiteralValues(source, 'view.ts')).toEqual([
      { file: 'view.ts', line: 1, kind: 'colour', value: '#abc' },
      { file: 'view.ts', line: 2, kind: 'spacing', value: '3px' },
      { file: 'view.ts', line: 3, kind: 'spacing', value: '1em' },
      { file: 'view.ts', line: 4, kind: 'spacing', value: '5px' },
    ]);
  });
});
