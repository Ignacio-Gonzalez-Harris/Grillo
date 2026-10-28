// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createXtermView, xtermOptions } from './terminal-view';

/** Made-up token values, so the test proves where each option comes from. */
const tokens: Record<string, string> = {
  '--font-family-mono': '"Sample Mono", monospace',
  '--font-size-s': '13px',
  '--color-terminal-bg': 'sample-background-colour',
  '--color-terminal-text': 'sample-text-colour',
  '--color-terminal-prompt': 'sample-prompt-colour',
};
const readToken = (name: string) => tokens[name] ?? '';

describe('xterm.js terminal view', () => {
  it('takes its font and colours from the terminal tokens, background transparency allowed', () => {
    expect(xtermOptions(readToken)).toEqual({
      allowTransparency: true,
      fontFamily: '"Sample Mono", monospace',
      fontSize: 13,
      theme: { background: 'sample-background-colour', foreground: 'sample-text-colour', cursor: 'sample-prompt-colour' },
    });
  });

  it('keeps output written before it is drawn, draws inside the element and moves when opened again', () => {
    const view = createXtermView(readToken);
    const first = document.createElement('div');
    const second = document.createElement('div');
    document.body.append(first, second);

    view.write('Sample output');
    view.open(first);
    const drawn = first.querySelector('.xterm');
    view.open(second);

    expect(drawn).not.toBeNull();
    expect(second.contains(drawn)).toBe(true);
    expect(view.cols).toBeGreaterThan(0);
    view.dispose();
    document.body.replaceChildren();
  });
});
