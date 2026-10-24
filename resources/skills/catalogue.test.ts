import { describe, expect, it } from 'vitest';
import { CatalogueError, parseCommandCatalogue, readCommandCatalogue } from './catalogue';

/** A catalogue README holding one command table with the given rows. */
function readmeWith(rows: string[], header = '| Command | Skill folder | Agent kind | Release | Typed by | What it does |'): string {
  return [
    '# Grillo skills',
    '',
    '## Commands',
    '',
    header,
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    '## Screen-to-agent protocol',
    '',
    '| Message | Exact text |',
    '|---|---|',
    '| Mode | `mode: listen\\|type` |',
    '',
  ].join('\n');
}

const wayfinderRow = '| `/grillo-wayfinder <path to source file>` | `grillo-wayfinder` | grilling | 1 | Screen 2 | Starts the map |';

describe('the command catalogue in resources/skills/README.md', () => {
  it('lists every Grillo command named after its skill folder, with the agent kind it opens and its release', async () => {
    const catalogue = await readCommandCatalogue();

    expect(catalogue.map(({ command, kind, release }) => ({ command, kind, release }))).toEqual([
      { command: '/grillo-wayfinder <path to source file>', kind: 'grilling', release: 1 },
      { command: '/grillo-tagging', kind: 'grilling', release: 1 },
      { command: '/grillo-meeting', kind: 'grilling', release: 1 },
      { command: '/grillo-answer <ticket number>', kind: 'grilling', release: 1 },
      { command: '/grillo-answer pickup', kind: 'grilling', release: 1 },
      { command: '/grillo-generic', kind: 'generic', release: 1 },
      { command: '/grillo-prd', kind: 'grilling', release: 1 },
      { command: '/grillo-prd regenerate', kind: 'grilling', release: 1 },
      { command: '/grillo-prd feedback', kind: 'grilling', release: 1 },
      { command: '/grillo-support', kind: 'support', release: 2 },
      { command: '/grillo-score', kind: 'grilling', release: 3 },
      { command: '/grillo-research <ticket number>', kind: 'research', release: 3 },
      { command: '/grillo-prototype <ticket number>', kind: 'prototype', release: 3 },
      { command: '/grillo-task <ticket number>', kind: 'task', release: 3 },
    ]);
    for (const entry of catalogue) {
      expect(entry.name).toBe(entry.folder);
    }
  });

  it('splits a command into its skill name and its argument', () => {
    const [entry] = parseCommandCatalogue(
      readmeWith(['| `/grillo-answer <ticket number>` | `grillo-answer` | grilling | 1 | Screen 6 | Own-time answer |']),
    );

    expect(entry).toEqual({
      command: '/grillo-answer <ticket number>',
      name: 'grillo-answer',
      argument: '<ticket number>',
      folder: 'grillo-answer',
      kind: 'grilling',
      release: 1,
    });
  });

  it('fails on a command listed twice, even with different spacing', () => {
    const readme = readmeWith([
      '| `/grillo-prd regenerate` | `grillo-prd` | grilling | 1 | Screen 8 | New version |',
      '| `/grillo-prd  regenerate` | `grillo-prd` | grilling | 1 | Screen 8 | Again |',
    ]);

    expect(() => parseCommandCatalogue(readme)).toThrow(CatalogueError);
    expect(() => parseCommandCatalogue(readme)).toThrow(/listed twice: \/grillo-prd regenerate/);
  });

  it('accepts one skill with several modes, which are different commands', () => {
    const readme = readmeWith([
      '| `/grillo-prd` | `grillo-prd` | grilling | 1 | Map done | Writes |',
      '| `/grillo-prd regenerate` | `grillo-prd` | grilling | 1 | Screen 8 | New version |',
    ]);

    expect(parseCommandCatalogue(readme).map((entry) => entry.command)).toEqual(['/grillo-prd', '/grillo-prd regenerate']);
  });

  it.each([
    ['a name that differs from its folder', '`/grillo-wayfinder`', '`grillo-wayfinde`'],
    ['a name without the grillo- prefix', '`/wayfinder`', '`wayfinder`'],
    ['the bare prefix', '`/grillo-`', '`grillo-`'],
    ['a double hyphen', '`/grillo--prd`', '`grillo--prd`'],
    ['capital letters', '`/grillo-PRD`', '`grillo-PRD`'],
    ['a colon', '`/grillo-prd:feedback`', '`grillo-prd:feedback`'],
    ['a hash', '`/grillo-answer#12`', '`grillo-answer#12`'],
    ['an equals sign', '`/grillo-answer=12`', '`grillo-answer=12`'],
    ['brackets', '`/grillo-[answer]`', '`grillo-[answer]`'],
    ['an underscore', '`/grillo_answer`', '`grillo_answer`'],
    ['no leading slash', '`grillo-answer`', '`grillo-answer`'],
    ['a name over 64 characters', `\`/grillo-${'a'.repeat(58)}\``, `\`grillo-${'a'.repeat(58)}\``],
  ])('fails on %s', (_case, command, folder) => {
    const readme = readmeWith([`| ${command} | ${folder} | grilling | 1 | Somewhere | Something |`]);

    expect(() => parseCommandCatalogue(readme)).toThrow(CatalogueError);
  });

  it('fails on a folder written as a path instead of the folder name', () => {
    const readme = readmeWith(['| `/grillo-answer` | `resources/skills/grillo-answer/` | grilling | 1 | Screen 6 | Answer |']);

    expect(() => parseCommandCatalogue(readme)).toThrow("the skill folder 'resources/skills/grillo-answer/' is not");
  });

  it.each([
    ['an agent kind that does not exist', '| `/grillo-x` | `grillo-x` | expert | 1 | Here | That |', /agent kind/],
    ['an empty agent kind', '| `/grillo-x` | `grillo-x` |  | 1 | Here | That |', /agent kind/],
    ['a release outside 1 to 3', '| `/grillo-x` | `grillo-x` | grilling | 4 | Here | That |', /release/],
    ['a release that is not a whole number', '| `/grillo-x` | `grillo-x` | grilling | 1.5 | Here | That |', /release/],
    ['a release written as a word', '| `/grillo-x` | `grillo-x` | grilling | one | Here | That |', /release/],
    ['a command that is not one code span', '| /grillo-x | `grillo-x` | grilling | 1 | Here | That |', /code span/],
    ['a folder that is not one code span', '| `/grillo-x` | grillo-x | grilling | 1 | Here | That |', /code span/],
    ['a row with too few cells', '| `/grillo-x` | `grillo-x` | grilling |', /cells/],
    ['a row with too many cells', '| `/grillo-x` | `grillo-x` | grilling | 1 | Here | That | Extra |', /cells/],
  ])('fails on %s', (_case, row, message) => {
    expect(() => parseCommandCatalogue(readmeWith([row]))).toThrow(CatalogueError);
    expect(() => parseCommandCatalogue(readmeWith([row]))).toThrow(message);
  });

  it('fails on a table missing one of the columns it reads', () => {
    const readme = readmeWith(
      ['| `/grillo-x` | `grillo-x` | grilling | Here | That | More |'],
      '| Command | Skill folder | Agent kind | Typed by | What it does | Notes |',
    );

    expect(() => parseCommandCatalogue(readme)).toThrow(/Release/);
  });

  it.each([
    ['no Commands section', '# Grillo skills\n\nNothing here.\n'],
    ['a Commands section without a table', '## Commands\n\nSoon.\n\n## Next\n'],
    ['a table with no rows', readmeWith([])],
    ['a table without its divider line', `## Commands\n\n| Command | Skill folder | Agent kind | Release |\n${wayfinderRow}\n`],
    ['an empty file', ''],
    ['null', null],
    ['a number', 42],
  ])('fails on %s', (_case, input) => {
    expect(() => parseCommandCatalogue(input as unknown as string)).toThrow(CatalogueError);
  });

  it('reads only the table of the Commands section, never a later table', () => {
    expect(parseCommandCatalogue(readmeWith([wayfinderRow])).map((entry) => entry.name)).toEqual(['grillo-wayfinder']);
  });

  it('reads a README written with Windows line breaks', () => {
    const readme = readmeWith([wayfinderRow]).replaceAll('\n', '\r\n');

    expect(parseCommandCatalogue(readme)).toHaveLength(1);
  });
});
