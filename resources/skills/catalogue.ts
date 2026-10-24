import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AGENT_KINDS, type AgentKind } from '../../src/shared/agents';

/**
 * Reads the command table of `resources/skills/README.md`, the catalogue every Grillo skill and screen follows.
 * Each skill's own test checks its name against it; this file's test checks the table itself.
 */

/** The releases of PRD section 12. */
const RELEASES = [1, 2, 3] as const;
export type Release = (typeof RELEASES)[number];

export interface CatalogueCommand {
  /** The exact first message, placeholders included: `/grillo-answer <ticket number>`. */
  command: string;
  /** The skill's name, the command without its slash and argument: `grillo-answer`. */
  name: string;
  /** What follows the name: a placeholder such as `<ticket number>`, a mode such as `pickup`, or empty. */
  argument: string;
  /** The skill's folder under `resources/skills/`. */
  folder: string;
  kind: AgentKind;
  release: Release;
}

/** The one error a malformed catalogue raises. */
export class CatalogueError extends Error {
  constructor(message: string) {
    super(`The command catalogue is malformed: ${message}`);
    this.name = 'CatalogueError';
  }
}

const COMMANDS_HEADING = '## Commands';
const COLUMNS = { command: 'Command', folder: 'Skill folder', kind: 'Agent kind', release: 'Release' } as const;
/**
 * A skill folder and its command: `grillo-` and hyphen-separated words of lowercase letters and digits, the
 * characters Claude Code allows in a skill name.
 */
const SKILL_NAME = /^grillo(?:-[a-z0-9]+)+$/;
/** Claude Code's longest skill name. */
const MAX_SKILL_NAME_LENGTH = 64;
const CODE_SPAN = /^`([^`]+)`$/;
const RELEASE_TEXT = /^[0-9]+$/;
const TABLE_DIVIDER = /^:?-+:?$/;

/** Splits one Markdown table line into its trimmed cells; `\|` is a pipe inside a cell. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'));
}

function isTableLine(line: string): boolean {
  return line.trim().startsWith('|');
}

/** The table lines of the Commands section: header, divider and rows. */
function commandTable(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === COMMANDS_HEADING);
  if (start === -1) {
    throw new CatalogueError(`no '${COMMANDS_HEADING}' section.`);
  }
  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => /^#{1,2} /.test(line));
  const body = end === -1 ? section : section.slice(0, end);
  const first = body.findIndex(isTableLine);
  if (first === -1) {
    throw new CatalogueError(`the '${COMMANDS_HEADING}' section holds no table.`);
  }
  const after = body.slice(first).findIndex((line) => !isTableLine(line));
  return after === -1 ? body.slice(first) : body.slice(first, first + after);
}

function codeSpan(cell: string, column: string, row: number): string {
  const match = CODE_SPAN.exec(cell);
  if (!match) {
    throw new CatalogueError(`row ${row}: the ${column} cell must be one code span, found '${cell}'.`);
  }
  return match[1].trim();
}

function parseRow(row: string[], index: Record<keyof typeof COLUMNS, number>, rowNumber: number): CatalogueCommand {
  const command = codeSpan(row[index.command], COLUMNS.command, rowNumber).split(/\s+/).join(' ');
  const folder = codeSpan(row[index.folder], COLUMNS.folder, rowNumber);
  const [head, ...rest] = command.split(' ');
  const name = head.startsWith('/') ? head.slice(1) : '';
  if (!SKILL_NAME.test(folder) || folder.length > MAX_SKILL_NAME_LENGTH) {
    throw new CatalogueError(
      `row ${rowNumber}: the skill folder '${folder}' is not 'grillo-' and lowercase words of at most ` +
        `${MAX_SKILL_NAME_LENGTH} characters.`,
    );
  }
  if (name !== folder) {
    throw new CatalogueError(`row ${rowNumber}: the command '${command}' does not match its skill folder '${folder}'.`);
  }

  const kind = row[index.kind];
  if (!(AGENT_KINDS as readonly string[]).includes(kind)) {
    throw new CatalogueError(`row ${rowNumber}: '${kind}' is not an agent kind (${AGENT_KINDS.join(', ')}).`);
  }
  const releaseText = row[index.release];
  const release = Number(releaseText);
  if (!RELEASE_TEXT.test(releaseText) || !(RELEASES as readonly number[]).includes(release)) {
    throw new CatalogueError(`row ${rowNumber}: '${releaseText}' is not a release (${RELEASES.join(', ')}).`);
  }

  return { command, name, argument: rest.join(' '), folder, kind: kind as AgentKind, release: release as Release };
}

/** Every command of the catalogue, in table order. Refuses a malformed table with `CatalogueError` only. */
export function parseCommandCatalogue(markdown: string): CatalogueCommand[] {
  if (typeof markdown !== 'string') {
    throw new CatalogueError('the README is not text.');
  }
  const [header, divider = [], ...rows] = commandTable(markdown).map(cells);
  if (divider.length === 0 || !divider.every((cell) => TABLE_DIVIDER.test(cell))) {
    throw new CatalogueError('the command table has no divider line under its header.');
  }
  const index = {} as Record<keyof typeof COLUMNS, number>;
  for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    index[key] = header.indexOf(column);
    if (index[key] === -1) {
      throw new CatalogueError(`the command table has no '${column}' column.`);
    }
  }
  if (rows.length === 0) {
    throw new CatalogueError('the command table has no rows.');
  }

  const seen = new Set<string>();
  return rows.map((row, offset) => {
    const rowNumber = offset + 1;
    if (row.length !== header.length) {
      throw new CatalogueError(`row ${rowNumber} has ${row.length} cells where the header has ${header.length}.`);
    }
    const entry = parseRow(row, index, rowNumber);
    if (seen.has(entry.command)) {
      throw new CatalogueError(`a command is listed twice: ${entry.command}`);
    }
    seen.add(entry.command);
    return entry;
  });
}

/** The catalogue as `resources/skills/README.md` holds it now. */
export async function readCommandCatalogue(): Promise<CatalogueCommand[]> {
  return parseCommandCatalogue(await readFile(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8'));
}
