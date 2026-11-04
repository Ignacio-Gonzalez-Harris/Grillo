import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { findLiteralValues } from '../src/renderer/theme/token-lint';

/** The UX prototype's download-site screen: the design the live site in site/ implements (issue #207). */
const PROTOTYPE = readFileSync(join(__dirname, '..', 'docs', 'ux', 'prototypes', 'grillo', 'index.html'), 'utf8');
const SCREEN_ID = 'screen-download-site';

/** The screen's own markup and its own style block, each as written in the prototype. */
function screenSource(): { markup: string; css: string } {
  const markup = PROTOTYPE.match(new RegExp(`<section id="${SCREEN_ID}"[\\s\\S]*?</section>\\s*(?=<!--)`))?.[0];
  const css = PROTOTYPE.match(new RegExp(`<style data-screen="${SCREEN_ID}">([\\s\\S]*?)</style>`))?.[1];
  if (!markup || !css) throw new Error(`the prototype has no markup or no style block for ${SCREEN_ID}`);
  return { markup, css };
}

/** One state of the screen, loaded into a browser-like window with the prototype's script left out. */
function screenState(state: 'pilot' | 'signed'): Element {
  const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true } });
  window.document.write(PROTOTYPE);
  const panel = window.document.querySelector(`#${SCREEN_ID} .state[data-state="${state}"]`);
  if (!panel) throw new Error(`the screen has no ${state} state`);
  return panel as unknown as Element;
}

function texts(panel: Element, selector: string): string[] {
  return [...panel.querySelectorAll(selector)].map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

/** Removes every `@media (prefers-reduced-motion: no-preference) { ... }` block, braces matched. */
function withoutMotionAllowedBlocks(css: string): string {
  const opening = /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{/g;
  let rest = css;
  for (let match = opening.exec(rest); match; match = opening.exec(rest)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth > 0 && end < rest.length) {
      if (rest[end] === '{') depth += 1;
      if (rest[end] === '}') depth -= 1;
      end += 1;
    }
    rest = rest.slice(0, match.index) + rest.slice(end);
    opening.lastIndex = match.index;
  }
  return rest;
}

const MOTION_PROPERTY = /(?:^|[{;\s])(?:animation|transition)(?:-[a-z-]+)?\s*:/;

describe('the download-site prototype screen', () => {
  it.each(['pilot', 'signed'] as const)('in the %s state, shows every part of the landing page', (state) => {
    const panel = screenState(state);
    const downloads = [...panel.querySelectorAll('[data-download]')];

    expect(panel.querySelector('.dl-hero img[src="grillo-logo.png"]')).not.toBeNull();
    expect(texts(panel, '.dl-hero h1')).toEqual(['Grillo']);
    expect(texts(panel, '.dl-pitch')).toHaveLength(1);
    expect(downloads.map((link) => link.getAttribute('data-download')).sort()).toEqual(['mac', 'windows']);
    expect(downloads.map((link) => link.classList.contains('dl-btn-own'))).toEqual([true, false]);
    expect(panel.querySelector('[data-all-releases]')).not.toBeNull();
    expect(texts(panel, '[data-release-line]')[0]).toMatch(/^Latest release: version /);
    expect(panel.querySelector('.dl-hero [data-app-mock]')).not.toBeNull();
    expect(panel.querySelector('.dl-glow')).not.toBeNull();
    expect(panel.querySelectorAll('.dl-features .dl-feature').length).toBeGreaterThanOrEqual(3);
    expect(panel.querySelectorAll('.dl-need li')).toHaveLength(3);
    expect(panel.querySelector('[data-install="windows"] ol li')).not.toBeNull();
    expect(panel.querySelector('[data-install="mac"] ol li')).not.toBeNull();

    const steps = [...panel.querySelectorAll('.dl-flow > li')];
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(5);
    for (const step of steps) expect(step.querySelector('svg')).not.toBeNull();
  });

  it.each(['pilot', 'signed'] as const)('in the %s state, asks for a GitHub account of any kind, not a company one', (state) => {
    const needs = texts(screenState(state), '.dl-need li');

    expect(needs).toContain('A GitHub account.');
    expect(needs.join(' ')).not.toMatch(/company/i);
  });

  it('shows no warning note, and the unsigned install steps in the pilot state only', () => {
    const pilot = screenState('pilot');
    const signed = screenState('signed');

    expect(pilot.querySelector('[data-warning="unsigned"]')).toBeNull();
    expect(pilot.querySelectorAll('.unsigned-only').length).toBeGreaterThan(0);
    expect(signed.querySelector('[data-warning="unsigned"]')).toBeNull();
    expect(signed.querySelectorAll('.unsigned-only')).toHaveLength(0);
  });

  it('uses no colour or spacing value outside tokens.css', () => {
    const { markup, css } = screenSource();

    expect([...findLiteralValues(css, 'screen.css'), ...findLiteralValues(markup, 'screen.html')]).toEqual([]);
  });

  it('moves only when the visitor’s system allows motion', () => {
    const { css } = screenSource();

    expect(css).toMatch(/@keyframes/);
    expect(withoutMotionAllowedBlocks(css)).not.toMatch(MOTION_PROPERTY);
  });
});
