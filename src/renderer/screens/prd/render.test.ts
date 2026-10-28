import { describe, expect, it } from 'vitest';
import { appendixCodes, renderPrdMarkdown, renderPrdVersion } from './render';

// Made-up PRD text only.
const LINKED = new Set(['S4', 'Q12.3']);

describe('renderPrdMarkdown: trace codes', () => {
  it('shows a code list as one chip whose codes link to their appendix entries, and leaves the rest as text', () => {
    const html = renderPrdMarkdown('Members sign in with GitHub only. [S4, Q12.3, S9]', LINKED);

    expect(html).toContain(
      '<span class="code-chip">[<a href="#code-S4">S4</a>, <a href="#code-Q12.3">Q12.3</a>, S9]</span>',
    );
  });

  it('marks [no source] as an unsourced chip', () => {
    expect(renderPrdMarkdown('A statement no answer supports. [no source]')).toContain(
      '<span class="code-chip nosrc">[no source]</span>',
    );
  });

  // Separator cases: line breaks, brackets, colon, hash and equals.
  it.each([
    ['one code', '[S4]', true],
    ['a question code', '[Q12.3]', true],
    ['no space after the comma', '[S4,Q12.3]', true],
    ['a line break after the comma', '[S4,\nQ12.3]', true],
    ['a link whose text is a code', '[S4](https://example.com)', false],
    ['a reference whose text is a code', '[S4][ref]\n\n[ref]: https://example.com', false],
    ['a colon after the brackets', 'see [S4]: there', false],
    ['a hash before the code', '[#S4]', false],
    ['an equals sign in the code', '[S4=1]', false],
    ['a lower-case code', '[s4]', false],
    ['a trailing comma', '[S4, ]', false],
    ['a number starting with zero', '[S04]', false],
    ['a question code with no question number', '[Q12]', false],
    ['nested brackets', '[[S4]]', true],
    ['empty brackets', '[]', false],
  ])('%s: %j is a chip: %s', (_case, markdown, isChip) => {
    expect(renderPrdMarkdown(markdown, LINKED).includes('class="code-chip"')).toBe(isChip);
  });
});

describe('renderPrdMarkdown: nothing in a PRD runs or loads', () => {
  it.each([
    ['a script block', '<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['an inline image tag', 'Text <img src=x onerror=alert(1)> more', '&lt;img src=x onerror=alert(1)&gt;'],
    ['an html comment', '<!-- hidden -->', '&lt;!-- hidden --&gt;'],
  ])('shows %s as text', (_case, markdown, shown) => {
    const html = renderPrdMarkdown(markdown);
    expect(html).toContain(shown);
    expect(html).not.toMatch(/<(script|img)\b/);
  });

  it.each([
    ['javascript:', '[click](javascript:alert(1))'],
    ['data:', '[click](data:text/html,hi)'],
    ['a file', '[click](file:///c/made-up.txt)'],
  ])('drops a %s link target and keeps its text', (_case, markdown) => {
    const html = renderPrdMarkdown(markdown);
    expect(html).toContain('click');
    expect(html).not.toContain('<a');
  });

  it('keeps web, mail and in-page links', () => {
    const html = renderPrdMarkdown('[web](https://example.com "Example") [mail](mailto:a@example.com) [here](#code-S4)');
    expect(html).toContain('<a href="https://example.com" title="Example">web</a>');
    expect(html).toContain('<a href="mailto:a@example.com">mail</a>');
    expect(html).toContain('<a href="#code-S4">here</a>');
  });

  it('turns an image into a link to it, never a picture loaded from elsewhere', () => {
    const html = renderPrdMarkdown('![A sample chart](https://example.com/chart.png) ![local](javascript:alert(1))');
    expect(html).toContain('<a href="https://example.com/chart.png">A sample chart</a>');
    expect(html).toContain('local');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
  });
});

describe('renderPrdVersion', () => {
  const version = {
    body: '# Sample PRD\n\n## Flows\n\n- A member borrows a tool. [S2, Q2.1]\n- A statement. [no source]\n',
    appendix: '# Audit appendix\n\n## Sources\n\n### S2\n- Who: sample-member\n\n## Questions\n\n### Q2.1\n- Question: How?\n\n## Unsourced\n\n- Flows: A statement.\n',
  };

  it('renders the body, then the appendix in its own section, with an anchor on every code entry', () => {
    const html = renderPrdVersion(version);

    expect(html.indexOf('<h1>Sample PRD</h1>')).toBeLessThan(html.indexOf('<section class="appendix">'));
    expect(html).toContain('<h3 id="code-S2">S2</h3>');
    expect(html).toContain('<h3 id="code-Q2.1">Q2.1</h3>');
    expect(html).toContain('[<a href="#code-S2">S2</a>, <a href="#code-Q2.1">Q2.1</a>]');
    expect(html).toContain('<h2>Unsourced</h2>');
  });

  it('has no appendix section when the version has none', () => {
    expect(renderPrdVersion({ body: 'Body only.', appendix: '' })).not.toContain('appendix');
  });

  it('finds the appendix entries by headings that are exactly one code', () => {
    expect([...appendixCodes('### S2\n### Q2.1 ###\n## Sources\n### S3 and more\n#### S10\r\n')]).toEqual(['S2', 'Q2.1', 'S10']);
  });
});
