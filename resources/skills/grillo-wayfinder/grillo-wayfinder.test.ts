import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { formatMapBody, formatTicketBody, parseComment, parseMapBody, parseTicketBody } from '../../../src/main/store/github/issues/bodies';
import { parseSource } from '../../../src/main/store/github/repo/records';
import { readCommandCatalogue } from '../catalogue';
import { checkProjectFixture, readFixtureFolder } from '../fixture-check';

/**
 * The grilling engine's skill files, checked without the model: the SKILL.md frontmatter and command against the
 * catalogue, every record format the skill teaches against the store's own parsers and `docs/store-layout.md`, and
 * the fixture of a session's output against the store layout. Live behaviour with the model is the demo's job.
 */

const SKILL_FOLDER = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = 'grillo-wayfinder';
const REPOSITORY_ROOT = join(SKILL_FOLDER, '..', '..', '..');
const SKILL_FILES = ['SKILL.md', 'references/record-answer.md'];
const FIXTURE = join(SKILL_FOLDER, 'fixtures', 'after-first-answers');

const read = (path: string): Promise<string> => readFile(join(SKILL_FOLDER, path), 'utf8').then((text) => text.replace(/\r\n/g, '\n'));

/** The YAML between the opening `---` line and the next `---` line. */
function frontmatterOf(markdown: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!match) {
    throw new Error('SKILL.md has no frontmatter');
  }
  return parseYaml(match[1]) as Record<string, unknown>;
}

/** The contents of every fenced code block. */
function codeBlocksOf(markdown: string): string[] {
  return [...markdown.matchAll(/^```[a-z]*\n([\s\S]*?)^```$/gm)].map((match) => match[1]);
}

/** The cells of the table rows in one `## ` section of a Markdown file, the header and divider left out. */
function tableRows(markdown: string, heading: string): string[][] {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  const section = markdown.slice(start + 1).split(/\n## /)[0];
  return section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()));
}

const codeSpans = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

describe('the grillo-wayfinder skill', () => {
  it('is named after its folder and answers the command the catalogue gives it', async () => {
    const frontmatter = frontmatterOf(await read('SKILL.md'));
    const entries = (await readCommandCatalogue()).filter((entry) => entry.folder === SKILL_NAME);

    expect(SKILL_FOLDER.endsWith(SKILL_NAME)).toBe(true);
    expect(frontmatter.name).toBe(SKILL_NAME);
    expect(entries.map((entry) => entry.command)).toEqual(['/grillo-wayfinder <path to source file>']);
    expect(frontmatter['argument-hint']).toBe(entries[0].argument);
    expect(typeof frontmatter.description).toBe('string');
    expect((frontmatter.description as string).length).toBeGreaterThan(0);
    expect(await read('SKILL.md')).toContain(entries[0].command.replace('/grillo-wayfinder', '`/grillo-wayfinder'));
  });

  it('names only commands the catalogue holds', async () => {
    const commands = new Set((await readCommandCatalogue()).map((entry) => entry.name));
    for (const file of SKILL_FILES) {
      const named = [...(await read(file)).matchAll(/\/(grillo-[a-z0-9-]+)/g)].map((match) => match[1]);

      expect(named.filter((name) => !commands.has(name)), file).toEqual([]);
    }
  });

  it('points only at files shipped with it, never at the repository files a project folder lacks', async () => {
    for (const file of SKILL_FILES) {
      const text = await read(file);
      const links = [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((match) => match[1]).filter((target) => !/^[a-z]+:/.test(target));
      for (const link of links) {
        const target = normalize(join(SKILL_FOLDER, dirname(file), link));

        expect(relative(SKILL_FOLDER, target).startsWith('..'), `${file} links ${link}`).toBe(false);
        expect(existsSync(target), `${file} links ${link}`).toBe(true);
      }
      expect(text, file).not.toMatch(/docs\/store-layout|resources\/skills|dev-next|new-issue\.md|docs\/PRDs/);
    }
  });

  it('teaches every label of the store layout', async () => {
    const layout = (await readFile(join(REPOSITORY_ROOT, 'docs', 'store-layout.md'), 'utf8')).replace(/\r\n/g, '\n');
    const labels = tableRows(layout, 'Labels').flatMap((row) => codeSpans(row[0]));
    const skill = await read('SKILL.md');

    expect(labels).toContain('wayfinder:map');
    for (const label of labels) {
      expect(skill).toContain(`\`${label}\``);
    }
  });

  it('teaches each comment marker of the store layout with its header lines in the layout order', async () => {
    const layout = (await readFile(join(REPOSITORY_ROOT, 'docs', 'store-layout.md'), 'utf8')).replace(/\r\n/g, '\n');
    const reference = await read('references/record-answer.md');
    const examples = codeBlocksOf(reference).filter((block) => block.startsWith('<!-- grillo:'));

    for (const [markerCell, , headersCell] of tableRows(layout, 'Comment markers')) {
      const [marker] = codeSpans(markerCell);
      const headers = codeSpans(headersCell)
        .map((header) => `\`${header}\``)
        .join(', ');
      const example = examples.find((block) => block.startsWith(`${marker}\n`));

      expect(reference, marker).toContain(`| \`${marker}\` |`);
      expect(reference, marker).toContain(headers);
      expect(example, marker).toBeDefined();
      expect(
        example
          ?.split('\n')
          .slice(1, headers.split(', ').length + 1)
          .map((line) => `\`${line.split(':')[0]}:\``)
          .join(', '),
      ).toBe(headers);
    }
  });

  it('shows every record in a shape the store reads back unchanged', async () => {
    const blocks = [...codeBlocksOf(await read('SKILL.md')), ...codeBlocksOf(await read('references/record-answer.md'))];
    const maps = blocks.filter((block) => block.startsWith('### Destination\n'));
    const tickets = blocks.filter((block) => block.startsWith('### Question\n'));
    const comments = blocks.filter((block) => block.startsWith('<!-- grillo:'));
    const sources = blocks.filter((block) => block.startsWith('kind: '));

    expect([maps.length, tickets.length, comments.length, sources.length]).toEqual([1, 1, 4, 1]);
    expect(formatMapBody(parseMapBody(maps[0], 'the map example')).trim()).toBe(maps[0].trim());
    expect(formatTicketBody(parseTicketBody(tickets[0], 2, 'the ticket example'), 2).trim()).toBe(tickets[0].trim());
    for (const [index, body] of comments.entries()) {
      expect(parseComment({ id: String(index + 1), author: 'ada-example', createdAt: '2026-10-24T09:00:00.000Z', body }).kind).not.toMatch(/plain|other/);
    }
    expect(parseSource(sources[0], 'S2', 'the source example').kind).toBe('own-time-answer');
  });
});

describe('the fixture of a session: the map, its tickets and the first answers', () => {
  it('follows the store layout, the Q code rule and the structure-section rule', async () => {
    const fixture = checkProjectFixture(await readFixtureFolder(FIXTURE));

    expect(fixture.map.destination.startsWith('A PRD for ')).toBe(true);
    expect(fixture.sources[0]).toMatchObject({ code: 'S1', kind: 'pasted-text' });
    expect(fixture.tickets.map((ticket) => ticket.kind)).toEqual(['grilling', 'grilling', 'research', 'grilling']);
    expect(fixture.mapDone).toBe(false);
  });

  it('cites, for an answer from a live session, a meeting source pointing at the session its discussion was cut from', async () => {
    const files = await readFixtureFolder(FIXTURE);
    const fixture = checkProjectFixture(files);
    const discussions = fixture.tickets.flatMap((ticket) => ticket.comments).filter((comment) => comment.kind === 'discussion');

    expect(discussions.length).toBeGreaterThan(0);
    for (const discussion of discussions) {
      const sources = fixture.sources.filter((source) => discussion.sources.includes(source.code));

      expect(sources.map((source) => [source.kind, source.where])).toEqual([['meeting', discussion.session]]);
      expect(files[discussion.session as string].replace(/\r\n/g, '\n')).toContain(sources[0].text.trim());
    }
  });

  it('cites, for an answer turned from a GitHub comment, a source holding that comment word for word', async () => {
    const fixture = checkProjectFixture(await readFixtureFolder(FIXTURE));
    const comments = fixture.tickets.flatMap((ticket) => ticket.comments);
    const pickedUp = comments.filter((comment) => comment.kind === 'answer').filter((answer) => answer.via === 'github');

    expect(pickedUp.length).toBeGreaterThan(0);
    for (const answer of pickedUp) {
      const origin = comments.find((comment) => comment.id === answer.from);
      const [source] = fixture.sources.filter((candidate) => answer.sources.includes(candidate.code));

      expect(origin?.kind).toBe('plain');
      expect(source.kind).toBe('own-time-answer');
      expect(source.where).toContain(`GitHub comment ${origin?.id}`);
      expect(source.text.trim()).toBe(origin?.kind === 'plain' ? origin.text.trim() : undefined);
    }
  });
});
