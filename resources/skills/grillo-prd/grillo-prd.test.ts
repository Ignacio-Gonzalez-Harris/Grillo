import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { formatPrdVersion, parsePrdVersion } from '../../../src/main/store/github/repo/records';
import { readCommandCatalogue } from '../catalogue';
import { checkProjectFixture, readFixtureFolder } from '../fixture-check';
import { checkPrdFixture, readPrdVersion } from './prd-check';

/**
 * The PRD writer's skill files, checked without the model: the SKILL.md frontmatter and commands against the
 * catalogue, the version format it teaches against the store's own parser and the PRD checker, and the fixture of a
 * project after one round of feedback against the store layout and the PRD rules. Live behaviour with the model is
 * the demo's job.
 */

const SKILL_FOLDER = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = 'grillo-prd';
const SKILLS_ROOT = join(SKILL_FOLDER, '..');
const SKILL_FILES = ['SKILL.md', 'references/prd-format.md'];
const FIXTURE = join(SKILL_FOLDER, 'fixtures', 'after-feedback');

const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');
const read = (path: string): Promise<string> => readFile(join(SKILL_FOLDER, path), 'utf8').then(unixLines);

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

async function readFixture(): Promise<Record<string, string>> {
  return Object.fromEntries(Object.entries(await readFixtureFolder(FIXTURE)).map(([path, text]) => [path, unixLines(text)]));
}

describe('the grillo-prd skill', () => {
  it('is named after its folder and answers the three commands the catalogue gives it', async () => {
    const skill = await read('SKILL.md');
    const frontmatter = frontmatterOf(skill);
    const entries = (await readCommandCatalogue()).filter((entry) => entry.folder === SKILL_NAME);

    expect(SKILL_FOLDER.endsWith(SKILL_NAME)).toBe(true);
    expect(frontmatter.name).toBe(SKILL_NAME);
    expect(entries.map((entry) => entry.command)).toEqual(['/grillo-prd', '/grillo-prd regenerate', '/grillo-prd feedback']);
    expect(typeof frontmatter.description).toBe('string');
    expect((frontmatter.description as string).length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(skill, entry.command).toContain(`\`${entry.command}\``);
      expect(frontmatter['argument-hint'] as string).toContain(entry.argument);
    }
  });

  it('names only commands the catalogue holds', async () => {
    const commands = new Set((await readCommandCatalogue()).map((entry) => entry.name));
    for (const file of SKILL_FILES) {
      const named = [...(await read(file)).matchAll(/\/(grillo-[a-z0-9-]+)/g)].map((match) => match[1]);

      expect(named.filter((name) => !commands.has(name)), file).toEqual([]);
    }
  });

  it('points only at files Grillo ships into the project folder, never at repository files a project lacks', async () => {
    for (const file of SKILL_FILES) {
      const text = await read(file);
      const links = [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((match) => match[1]).filter((target) => !/^[a-z]+:/.test(target));
      for (const link of links) {
        const target = normalize(join(SKILL_FOLDER, dirname(file), link));

        expect(relative(SKILL_FOLDER, target).startsWith('..'), `${file} links ${link}`).toBe(false);
        expect(existsSync(target), `${file} links ${link}`).toBe(true);
      }
      for (const [, shipped] of text.matchAll(/\.claude\/skills\/(grillo-[a-z0-9-]+\/[^`\s]+)/g)) {
        expect(existsSync(join(SKILLS_ROOT, shipped)), `${file} names .claude/skills/${shipped}`).toBe(true);
      }
      expect(text, file).not.toMatch(/docs\/store-layout|resources\/skills|dev-next|new-issue\.md|docs\/PRDs/);
    }
  });

  it('follows only grillo-wayfinder sections that exist, by their heading', async () => {
    const wayfinder = unixLines(await readFile(join(SKILLS_ROOT, 'grillo-wayfinder', 'SKILL.md'), 'utf8'));
    // A heading's name is its text before any ` (...)` note: `Working a ticket (the engine ...)` is `Working a ticket`.
    const headings = new Set([...wayfinder.matchAll(/^## (.+?)(?: \(.*\))?$/gm)].map((match) => match[1]));
    const named = [...(await read('SKILL.md')).matchAll(/`grillo-wayfinder`, "([^"]+)"/g)].map((match) => match[1].replace(/\s+/g, ' '));

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => !headings.has(name))).toEqual([]);
  });

  it('shows the version file in a shape the store reads back unchanged and the PRD checker accepts', async () => {
    const examples = codeBlocksOf(await read('references/prd-format.md')).filter((block) => block.startsWith('version: '));

    expect(examples).toHaveLength(1);
    const version = parsePrdVersion(examples[0], 'the version example');
    const written = readPrdVersion(examples[0], 'the version example');

    expect(formatPrdVersion(version).trim()).toBe(examples[0].trim());
    expect(written.sections.map((section) => section.name)).toEqual(['Flows']);
    expect(written.sections[0].statements.map((statement) => statement.codes)).toEqual([['S2', 'Q2.1'], null]);
    expect(written.unsourced).toHaveLength(1);
  });
});

describe('the fixture of a project after one round of feedback: two PRD versions', () => {
  it('writes the latest version, once the map is done, in every structure section in order', async () => {
    const files = await readFixture();
    const { project, versions } = checkPrdFixture(files);
    const structure = (JSON.parse(files['.grillo/structure.json']) as { sections: { name: string }[] }).sections.map((section) => section.name);

    expect(project.mapDone).toBe(true);
    expect(versions.map((version) => version.number)).toEqual([1, 2]);
    expect(versions.at(-1)?.sections.map((section) => section.name)).toEqual(structure);
  });

  it('turns a confirmed [no source] statement into one with codes in the next version, the earlier version kept', async () => {
    const [v1, v2] = checkPrdFixture(await readFixture()).versions;
    const statements = (version: typeof v1) => version.sections.flatMap((section) => section.statements);

    expect(v1.unsourced).toEqual([{ section: 'Flows', text: 'The shed screen shows who has each tool right now.' }]);
    expect(statements(v1).filter((statement) => statement.codes === null)).toHaveLength(1);
    expect(v2.unsourced).toEqual([]);
    expect(statements(v2).find((statement) => statement.codes?.includes('Q7.1'))?.codes).toEqual(['S8', 'Q7.1']);
  });

  it('keeps every code meaning the same thing across versions', async () => {
    const [v1, v2] = checkPrdFixture(await readFixture()).versions;
    const entries = (version: typeof v1) => new Map<string, unknown>([...version.sources, ...version.questions].map((entry) => [entry.code, entry]));
    const [first, second] = [entries(v1), entries(v2)];
    const shared = [...first.keys()].filter((code) => second.has(code));

    expect(shared.length).toBeGreaterThan(0);
    expect([...first.keys()].filter((code) => !second.has(code))).toEqual([]);
    for (const code of shared) {
      expect(second.get(code), code).toEqual(first.get(code));
    }
  });

  it('leaves a structure section with no decision unwritten: a fog line holds it and the map is not done', async () => {
    const files = await readFixture();
    const structure = JSON.parse(files['.grillo/structure.json']) as { sections: { name: string; note: string }[] };
    structure.sections.push({ name: 'Costs', note: 'What the app costs the garden' });
    const withSection = { ...files, '.grillo/structure.json': JSON.stringify(structure) };
    const withFog = { ...withSection, 'issues/1.md': files['issues/1.md'].replace('### Fog\n', '### Fog\n- Costs: whether members pay a deposit\n') };
    const writtenAnyway = {
      ...withFog,
      '.grillo/prd/v3.md': files['.grillo/prd/v2.md']
        .replace('version: 2\ndate: 2026-10-26T15:00:00.000Z', 'version: 3\ndate: 2026-10-27T09:00:00.000Z')
        .replace('<!-- grillo:appendix -->', '## Costs\n\n- Members pay no deposit. [no source]\n\n<!-- grillo:appendix -->')
        .replace('## Unsourced\n\nNone.', '## Unsourced\n\n- Costs: Members pay no deposit.'),
    };

    expect(() => checkProjectFixture(withSection)).toThrow(/'Costs' has no settled decision, no open ticket and no fog line/);
    expect(checkPrdFixture(withFog).project.mapDone).toBe(false);
    expect(() => checkPrdFixture(writtenAnyway)).toThrow(/section 'Costs' is written, but none of its statements cites a decided question/);
  });
});
