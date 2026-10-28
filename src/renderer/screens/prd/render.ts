/**
 * A PRD version as HTML (PRD section 4.7 items 4-5): its Markdown body and audit appendix rendered with `marked`, every
 * trace code (`[S4, Q12.3]`) shown as a chip whose codes link to their entry in the appendix, and `[no source]` marked
 * as unsourced. The same HTML fills the screen and the exported file.
 *
 * A PRD version is text from the project repository, which any member (and any agent) can write. So nothing in it
 * runs or loads: raw HTML is shown as text, a link keeps its target only for the web, mail or a place in the page, and
 * an image becomes a link to where it lives, never a picture loaded from elsewhere.
 */
import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import type { PrdVersion } from '../../../main/store/types';

/** One source or question code: `S<n>` or `Q<ticket issue number>.<k>` (docs/store-layout.md, Codes). */
const CODE = 'S[1-9]\\d*|Q[1-9]\\d*\\.[1-9]\\d*';
const ONE_CODE = new RegExp(`^(?:${CODE})$`);
/** `[S4, Q12.3]`: one or more codes, comma-separated, in square brackets, and not the text of a link. */
const TRACE = new RegExp(`^\\[((?:${CODE})(?:,\\s*(?:${CODE}))*)\\](?![([:])`);
const NO_SOURCE = /^\[no source\](?![([:])/;
const SAFE_LINK = /^(?:https?:|mailto:|#)/i;

/** The id of a code's entry in the appendix, which its chips link to. */
export function codeAnchor(code: string): string {
  return `code-${code}`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Every code the appendix has an entry for: a heading whose whole text is the code (`### S4`). */
export function appendixCodes(appendix: string): Set<string> {
  const codes = new Set<string>();
  for (const line of appendix.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading && ONE_CODE.test(heading[1])) codes.add(heading[1]);
  }
  return codes;
}

interface TraceToken extends Tokens.Generic {
  type: 'trace';
  codes: string[];
}

function chip(inner: string, unsourced = false): string {
  return `<span class="code-chip${unsourced ? ' nosrc' : ''}">${inner}</span>`;
}

function markdownRenderer(linked: ReadonlySet<string>): Marked {
  const trace: TokenizerAndRendererExtension = {
    name: 'trace',
    level: 'inline',
    start: (src) => {
      const at = src.indexOf('[');
      return at < 0 ? undefined : at;
    },
    tokenizer(src) {
      const codes = TRACE.exec(src);
      if (codes) {
        const token: TraceToken = { type: 'trace', raw: codes[0], codes: codes[1].split(/,\s*/) };
        return token;
      }
      const none = NO_SOURCE.exec(src);
      return none ? { type: 'trace', raw: none[0], codes: [] } : undefined;
    },
    renderer(token) {
      const { codes } = token as TraceToken;
      if (codes.length === 0) return chip('[no source]', true);
      const parts = codes.map((code) => (linked.has(code) ? `<a href="#${codeAnchor(code)}">${code}</a>` : code));
      return chip(`[${parts.join(', ')}]`);
    },
  };

  return new Marked({
    gfm: true,
    extensions: [trace],
    renderer: {
      html: ({ text }) => escapeHtml(text),
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        if (!SAFE_LINK.test(href.trim())) return text;
        const titled = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(href.trim())}"${titled}>${text}</a>`;
      },
      image({ href, text }) {
        const label = escapeHtml(text || href);
        return SAFE_LINK.test(href.trim()) ? `<a href="${escapeHtml(href.trim())}">${label}</a>` : label;
      },
      heading({ tokens, depth, text }) {
        const code = text.trim();
        const id = ONE_CODE.test(code) ? ` id="${codeAnchor(code)}"` : '';
        return `<h${depth}${id}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
  });
}

/** One piece of a PRD version's Markdown as HTML; a chip's code links to the appendix only when `linked` holds it. */
export function renderPrdMarkdown(markdown: string, linked: ReadonlySet<string> = new Set()): string {
  return markdownRenderer(linked).parse(markdown, { async: false });
}

/** The version's body, then its audit appendix, as the HTML the screen and the exported file show. */
export function renderPrdVersion(version: Pick<PrdVersion, 'body' | 'appendix'>): string {
  const linked = appendixCodes(version.appendix);
  const body = renderPrdMarkdown(version.body, linked);
  if (version.appendix.trim() === '') return body;
  return `${body}<section class="appendix">\n${renderPrdMarkdown(version.appendix, linked)}</section>\n`;
}
