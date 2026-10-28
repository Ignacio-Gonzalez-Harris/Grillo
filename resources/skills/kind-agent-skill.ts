import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { parseComment, TICKET_KINDS } from '../../src/main/store/github/issues/bodies';
import { parseSource } from '../../src/main/store/github/repo/records';
import { readCommandCatalogue } from './catalogue';
import { type KindAgent, sourceFitsKind } from './kind-run';

/**
 * The checks every kind agent's skill file passes without the model, registered by each skill's own test: the
 * SKILL.md frontmatter and command against the catalogue, the sections of grillo-wayfinder and record-answer.md it
 * follows by name, the screen messages it handles against the catalogue's protocol, the kind of ticket it works, and
 * the records it shows against the store's own parsers and the sources its kind rests on.
 */

const SKILLS_ROOT = dirname(fileURLToPath(import.meta.url));
/** The ticket each skill example records on. */
const EXAMPLE_TICKET = 2;
/** The engine sections every kind agent follows by name, from grillo-wayfinder's SKILL.md. */
const ENGINE_SECTIONS = ['Step 0: check GitHub and the project folder', 'The structure-section step', 'Claiming a ticket', 'Working a ticket', 'The map-done rule'];
/** The command that works each kind of ticket: grilling tickets are answered with an agent in the own-time chat. */
const commandFor = (kind: string): string => (kind === 'grilling' ? '/grillo-answer' : `/grillo-${kind}`);

const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');
const readSkills = (path: string): Promise<string> => readFile(join(SKILLS_ROOT, path), 'utf8').then(unixLines);

/** The YAML between the opening `---` line and the next `---` line. */
function frontmatterOf(markdown: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!match) {
    throw new Error('SKILL.md has no frontmatter');
  }
  return parseYaml(match[1]) as Record<string, unknown>;
}

/** The contents of every fenced code block. */
const codeBlocksOf = (markdown: string): string[] => [...markdown.matchAll(/^```[a-z]*\n([\s\S]*?)^```$/gm)].map((match) => match[1]);

/** One `## ` section of a Markdown file, up to the next one. */
function sectionOf(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  return start === -1 ? '' : markdown.slice(start + 1).split(/\n## /)[0];
}

/** The cells of the table rows in a piece of Markdown, the header and divider left out. */
const tableRows = (markdown: string): string[][] =>
  markdown
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => line.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim()));

const codeSpans = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

/** A heading's name: its text before any ` (...)` note, so `Working a ticket (the engine ...)` is `Working a ticket`. */
const headingNames = (markdown: string): Set<string> => new Set([...markdown.matchAll(/^#{2,3} (.+?)(?: \(.*\))?$/gm)].map((match) => match[1]));

/** The GitHub anchor of a heading. */
const anchorOf = (heading: string): string => heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');

/** The keyword of a protocol control line: `present: <logins>` is `present:`, `jump <ticket number>` is `jump`. */
const keywordOf = (controlLine: string): string => /^[a-z]+:|^[a-z ]+?(?= <|$)/.exec(controlLine)?.[0] ?? controlLine;

/**
 * Registers the shared checks of one kind agent's skill. `recordAnswerRows` are the rows of record-answer.md's source
 * table the skill records with, by the start of their first cell.
 */
export function itChecksTheKindAgentSkill(kind: KindAgent, recordAnswerRows: string[]): void {
  const folder = `grillo-${kind}`;
  const skillFolder = join(SKILLS_ROOT, folder);
  const readSkill = (): Promise<string> => readSkills(`${folder}/SKILL.md`);

  it('is named after its folder and answers the one command the catalogue gives it', async () => {
    const skill = await readSkill();
    const frontmatter = frontmatterOf(skill);
    const entries = (await readCommandCatalogue()).filter((entry) => entry.folder === folder);

    expect(frontmatter.name).toBe(folder);
    expect(entries.map((entry) => [entry.command, entry.kind, entry.release])).toEqual([[`/${folder} <ticket number>`, kind, 3]]);
    expect(frontmatter['argument-hint']).toBe(entries[0].argument);
    expect(frontmatter['disable-model-invocation']).toBe(true);
    expect(typeof frontmatter.description).toBe('string');
    expect(skill).toContain(`\`${entries[0].command}\``);
  });

  it('names only commands the catalogue holds', async () => {
    const commands = new Set((await readCommandCatalogue()).map((entry) => entry.name));
    const named = [...(await readSkill()).matchAll(/\/(grillo-[a-z0-9-]+)/g)].map((match) => match[1]);

    expect(named.filter((name) => !commands.has(name))).toEqual([]);
  });

  it('points only at its own sections and at files Grillo ships into the project folder', async () => {
    const skill = await readSkill();
    const anchors = new Set([...skill.matchAll(/^#{2,3} (.+)$/gm)].map((match) => anchorOf(match[1])));
    const links = [...skill.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]).filter((target) => !/^[a-z]+:/.test(target));

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const [path, anchor] = link.split('#');
      if (path === '') {
        expect(anchors, link).toContain(anchor);
      } else {
        const target = normalize(join(skillFolder, path));
        expect(relative(skillFolder, target).startsWith('..'), link).toBe(false);
        expect(existsSync(target), link).toBe(true);
      }
    }
    for (const [, shipped] of skill.matchAll(/\.claude\/skills\/(grillo-[a-z0-9-]+\/[^`\s]+)/g)) {
      expect(existsSync(join(SKILLS_ROOT, shipped)), `.claude/skills/${shipped}`).toBe(true);
    }
    expect(skill).not.toMatch(/docs\/store-layout|resources\/skills|dev-next|new-issue\.md|docs\/PRDs/);
  });

  it('follows the engine by grillo-wayfinder and record-answer sections that exist, by their heading', async () => {
    const skill = (await readSkill()).replace(/\s+/g, ' ');
    const wayfinder = headingNames(await readSkills('grillo-wayfinder/SKILL.md'));
    const recordAnswer = headingNames(await readSkills('grillo-wayfinder/references/record-answer.md'));
    const namedIn = (pattern: RegExp): string[] => [...skill.matchAll(pattern)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((name) => name[1]));
    const wayfinderNames = namedIn(/\(`grillo-wayfinder`, ([^)]*)\)/g);
    const recordAnswerNames = namedIn(/\(record-answer\.md, ([^)]*)\)/g);

    expect(wayfinderNames).toEqual(expect.arrayContaining(ENGINE_SECTIONS));
    expect(wayfinderNames.filter((name) => !wayfinder.has(name))).toEqual([]);
    expect(recordAnswerNames).toEqual(expect.arrayContaining(['Step 1: the contradiction check', 'Step 2: the source file', 'Step 3: the answer comment']));
    expect(recordAnswerNames.filter((name) => !recordAnswer.has(name))).toEqual([]);
  });

  it('handles every screen message the catalogue sends any agent, and turns away the meeting-only ones', async () => {
    const protocol = tableRows(sectionOf(await readSkills('README.md'), 'Screen-to-agent protocol'));
    const handled = tableRows(sectionOf(await readSkill(), 'Messages from Grillo\'s screens'));
    const rowFor = (keyword: string) => handled.find((row) => codeSpans(row[0]).map(keywordOf).includes(keyword));

    expect(protocol.length).toBeGreaterThan(0);
    for (const [, controlCell, , acceptedBy] of protocol) {
      const keyword = keywordOf(codeSpans(controlCell)[0]);
      const meetingOnly = acceptedBy === '`/grillo-meeting`';
      const row = rowFor(keyword);

      expect(row, keyword).toBeDefined();
      expect(row?.[1].includes(`never to a ${kind} agent`), keyword).toBe(meetingOnly);
    }
  });

  it('works only tickets of its own kind, and names the command that works every other kind', async () => {
    const skill = await readSkill();

    expect(skill).toContain(`\`wayfinder:${kind}\``);
    for (const other of TICKET_KINDS.filter((candidate) => candidate !== kind)) {
      expect(skill, other).toContain(`\`${commandFor(other)} <N>\``);
    }
  });

  it('teaches the sources of record-answer.md it records with', async () => {
    const rows = tableRows(sectionOf(await readSkills('grillo-wayfinder/references/record-answer.md'), 'Step 2: the source file'));
    const skill = await readSkill();

    for (const start of recordAnswerRows) {
      const [, kindCell, , , whereCell] = rows.find((cells) => cells[0].startsWith(start)) ?? [];
      const where = codeSpans(whereCell ?? '')[0];

      expect(kindCell, start).toBeDefined();
      expect(skill, start).toContain(`\`kind: ${codeSpans(kindCell)[0]}\``);
      if (where !== undefined) {
        expect(skill, start).toContain(`\`${where}\``);
      }
    }
  });

  it('shows its records in a shape the store reads back, resting on a source of its kind', async () => {
    const blocks = codeBlocksOf(await readSkill());
    const sources = blocks.filter((block) => block.startsWith('kind: ')).map((text, index) => parseSource(text, `S${index + 2}`, 'the source example'));
    const comments = blocks
      .filter((block) => block.startsWith('<!-- grillo:'))
      .map((body, index) => parseComment({ id: String(2001 + index), author: 'ada-example', createdAt: '2026-10-24T09:00:00.000Z', body }));

    expect(sources.length).toBeGreaterThan(0);
    expect(comments.map((comment) => comment.kind)).toContain('answer');
    for (const source of sources) {
      expect(sourceFitsKind(source, kind, EXAMPLE_TICKET), source.code).toBe(true);
    }
    for (const comment of comments) {
      expect(comment).toMatchObject({ who: 'ada-example', via: null });
    }
  });
}
