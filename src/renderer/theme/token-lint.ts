/**
 * The token lint: every colour and spacing value in the renderer must be a `var(--...)` token from theme/tokens.css
 * (CLAUDE.md section 2: never invent a colour or a spacing value). It reads stylesheets, the style blocks and style
 * attributes of HTML, and the inline styles TypeScript sets.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export type LiteralKind = 'colour' | 'spacing';

/** One literal value where a token belongs. */
export interface LiteralValue {
  file: string;
  line: number;
  kind: LiteralKind;
  value: string;
}

/** The token file itself, the one place literal values live; relative to the renderer folder. */
const TOKEN_FILE = 'theme/tokens.css';
const LINTED_EXTENSIONS = new Set(['.css', '.html', '.ts']);
const TEST_FILE = /\.test\.ts$/;

/** The CSS named colours (CSS Color Module Level 4); `transparent` and `currentColor` are keywords, not values. */
const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
    'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod ' +
    'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon ' +
    'darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray ' +
    'dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green ' +
    'greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon ' +
    'lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon ' +
    'lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta ' +
    'maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen ' +
    'mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
    'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru ' +
    'pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen ' +
    'seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato ' +
    'turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/g;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const WORD = /\b[a-zA-Z]+\b/g;
const LENGTH = /(?<![\w.#])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|pt|pc|cm|mm|in|q|ch|ex|vmin|vmax)\b/gi;

const COMMENT = /\/\*[\s\S]*?\*\//g;
const QUOTED = /"[^"\n]*"|'[^'\n]*'/g;
const AT_RULE_PRELUDE = /@[a-zA-Z-]+[^{;]*/g;
const DECLARATION = /(?:^|[{;\s])-{0,2}[a-zA-Z][\w-]*\s*:([^;{}]*)/g;
const CUSTOM_PROPERTY_NAME = /--[\w-]+/g;

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const STYLE_ATTRIBUTE = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const STYLE_ASSIGNMENT = /\.style\.([a-zA-Z]+)\s*=\s*(['"`])([^'"`\n]*)\2/g;
const STYLE_SET_PROPERTY = /\.style\.setProperty\(\s*(['"`])([^'"`]+)\1\s*,\s*(['"`])([^'"`\n]*)\3/g;

/** A piece of CSS text and the offset in the file where it starts. */
interface CssChunk {
  css: string;
  offset: number;
}

/** Replaces every character but line breaks with a space, so offsets and line numbers stay where they were. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
}

function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

function kebabCase(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function htmlChunks(content: string): CssChunk[] {
  const chunks: CssChunk[] = [];
  for (const match of content.matchAll(STYLE_BLOCK)) {
    chunks.push({ css: match[1], offset: match.index + match[0].indexOf(match[1]) });
  }
  for (const match of content.matchAll(STYLE_ATTRIBUTE)) {
    const css = match[1] ?? match[2];
    chunks.push({ css, offset: match.index + match[0].indexOf(css) });
  }
  return chunks;
}

/**
 * A declaration built from a value TypeScript sets. The property name is put in front of the value, and the chunk
 * starts that many characters earlier, so a literal still points at its place in the file (the code before the value
 * on the same line, such as `.style.color = '`, is always longer than the name put in front).
 */
function declarationChunk(prefix: string, value: string, valueOffset: number): CssChunk {
  return { css: `${prefix}${value}`, offset: valueOffset - prefix.length };
}

function typescriptChunks(content: string): CssChunk[] {
  const chunks = htmlChunks(content);
  for (const match of content.matchAll(STYLE_ASSIGNMENT)) {
    const [whole, property, , value] = match;
    const prefix = property === 'cssText' ? '' : `${kebabCase(property)}: `;
    chunks.push(declarationChunk(prefix, value, match.index + whole.lastIndexOf(value)));
  }
  for (const match of content.matchAll(STYLE_SET_PROPERTY)) {
    const [whole, , property, , value] = match;
    chunks.push(declarationChunk(`${property}: `, value, match.index + whole.lastIndexOf(value)));
  }
  return chunks;
}

function chunksOf(content: string, file: string): CssChunk[] {
  switch (extname(file)) {
    case '.css':
      return [{ css: content, offset: 0 }];
    case '.html':
      return htmlChunks(content);
    case '.ts':
      return typescriptChunks(content);
    default:
      return [];
  }
}

/** Every literal in one declaration value, as [position in the value, kind, text], in reading order. */
function literalsIn(value: string): Array<[number, LiteralKind, string]> {
  const plain = value.replace(CUSTOM_PROPERTY_NAME, blank);
  const found: Array<[number, LiteralKind, string]> = [];
  for (const match of plain.matchAll(HEX_COLOUR)) found.push([match.index, 'colour', match[0]]);
  for (const match of plain.matchAll(COLOUR_FUNCTION)) found.push([match.index, 'colour', match[0]]);
  for (const match of plain.matchAll(WORD)) {
    if (NAMED_COLOURS.has(match[0].toLowerCase())) found.push([match.index, 'colour', match[0]]);
  }
  for (const match of plain.matchAll(LENGTH)) {
    if (Number.parseFloat(match[0]) !== 0) found.push([match.index, 'spacing', match[0]]);
  }
  return found.sort((a, b) => a[0] - b[0]);
}

/** Finds every literal colour or spacing value in one file's content; `file` names the file and picks its reader. */
export function findLiteralValues(content: string, file: string): LiteralValue[] {
  const found: Array<{ offset: number; kind: LiteralKind; value: string }> = [];
  for (const chunk of chunksOf(content, file)) {
    const css = chunk.css.replace(COMMENT, blank).replace(QUOTED, blank).replace(AT_RULE_PRELUDE, blank);
    for (const declaration of css.matchAll(DECLARATION)) {
      const valueStart = declaration.index + declaration[0].length - declaration[1].length;
      for (const [position, kind, value] of literalsIn(declaration[1])) {
        found.push({ offset: chunk.offset + valueStart + position, kind, value });
      }
    }
  }
  return found
    .sort((a, b) => a.offset - b.offset)
    .map(({ offset, kind, value }) => ({ file, line: lineAt(content, offset), kind, value }));
}

function filesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** Lints every stylesheet, HTML page and source file under the renderer folder, except the token file and tests. */
export function lintRendererFolder(rendererFolder: string): LiteralValue[] {
  return filesUnder(rendererFolder)
    .map((path) => relative(rendererFolder, path).split('\\').join('/'))
    .filter((file) => LINTED_EXTENSIONS.has(extname(file)) && file !== TOKEN_FILE && !TEST_FILE.test(file))
    .flatMap((file) => findLiteralValues(readFileSync(join(rendererFolder, file), 'utf8'), file));
}
