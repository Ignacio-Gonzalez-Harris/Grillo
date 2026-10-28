import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { readCommandCatalogue } from '../catalogue';
import { FixtureError, readFixtureFolder } from '../fixture-check';
import { checkScoreFixture, CRITERIA, overallOf, readScore } from './score-check';

/**
 * The PRD grader's skill files, checked without the model: the SKILL.md frontmatter and command against the
 * catalogue, the score file it teaches against the store's `Score` type and the score checker, the rule that a score
 * is guidance and never a gate, the one line in the PRD writer that starts it, and the fixture of a project whose two
 * PRD versions are scored against the store layout and the scoring rules. Live behaviour with the model is the demo's
 * job.
 */

const SKILL_FOLDER = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = 'grillo-score';
const SKILLS_ROOT = join(SKILL_FOLDER, '..');
const SKILL_FILES = ['SKILL.md', 'references/score-format.md'];
const FIXTURE = join(SKILL_FOLDER, 'fixtures', 'after-scoring');
/** The PRD writer's fixture: the same project, before its versions were scored. */
const BEFORE_SCORING = join(SKILLS_ROOT, 'grillo-prd', 'fixtures', 'after-feedback');
const V1_SCORE = '.grillo/prd/v1.score.json';
const V2_SCORE = '.grillo/prd/v2.score.json';

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

/** The contents of every fenced code block of one language. */
function codeBlocksOf(markdown: string, language: string): string[] {
  return [...markdown.matchAll(new RegExp(`^\`\`\`${language}\\n([\\s\\S]*?)^\`\`\`$`, 'gm'))].map((match) => match[1]);
}

/** One `## ` section of a Markdown file, up to the next one. */
function sectionOf(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  return start === -1 ? '' : markdown.slice(start + 1).split(/\n## /)[0];
}

async function readFiles(folder: string): Promise<Record<string, string>> {
  return Object.fromEntries(Object.entries(await readFixtureFolder(folder)).map(([path, text]) => [path, unixLines(text)]));
}

const fixture = await readFiles(FIXTURE);
const latestVersion = () => checkScoreFixture(fixture).versions[1];
const structureSections = (): string[] =>
  (JSON.parse(fixture['.grillo/structure.json']) as { sections: { name: string }[] }).sections.map((section) => section.name);

describe('the grillo-score skill', () => {
  it('is named after its folder and answers the one command the catalogue gives it', async () => {
    const skill = await read('SKILL.md');
    const frontmatter = frontmatterOf(skill);
    const entries = (await readCommandCatalogue()).filter((entry) => entry.folder === SKILL_NAME);

    expect(SKILL_FOLDER.endsWith(SKILL_NAME)).toBe(true);
    expect(frontmatter.name).toBe(SKILL_NAME);
    expect(entries.map((entry) => [entry.command, entry.kind, entry.release])).toEqual([['/grillo-score', 'grilling', 3]]);
    expect(typeof frontmatter.description).toBe('string');
    expect((frontmatter.description as string).length).toBeGreaterThan(0);
    expect(frontmatter['argument-hint']).toBeUndefined();
    expect(frontmatter['disable-model-invocation']).toBe(true);
    expect(skill).toContain('`/grillo-score`');
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

  it('follows only grillo-wayfinder and grillo-prd sections that exist, by their heading', async () => {
    const skill = await read('SKILL.md');
    for (const other of ['grillo-wayfinder', 'grillo-prd']) {
      const text = unixLines(await readFile(join(SKILLS_ROOT, other, 'SKILL.md'), 'utf8'));
      // A heading's name is its text before any ` (...)` note: `Step 0: check ... (every session, ...)` is `Step 0: check ...`.
      const headings = new Set([...text.matchAll(/^#{2,3} (.+?)(?: \(.*\))?$/gm)].map((match) => match[1]));
      const named = [...skill.matchAll(new RegExp(`\`${other}\`, "([^"]+)"`, 'g'))].map((match) => match[1].replace(/\s+/g, ' '));

      expect(named.length, other).toBeGreaterThan(0);
      expect(named.filter((name) => !headings.has(name)), other).toEqual([]);
    }
  });

  it('teaches the eight quality criteria in the order the checker scores them', async () => {
    const format = await read('references/score-format.md');
    const listed = [...sectionOf(format, 'Quality: the eight criteria').matchAll(/^\| \*\*([^*]+)\*\* \|/gm)].map((match) => match[1]);

    expect(listed).toEqual([...CRITERIA]);
  });

  it('shows a score file that matches the store Score type and the scoring rules', async () => {
    const examples = codeBlocksOf(await read('references/score-format.md'), 'json');

    expect(examples).toHaveLength(1);
    const score = readScore(examples[0], latestVersion(), 'the score example');

    expect(score.criteria.map((item) => item.name)).toEqual([...CRITERIA]);
    expect(score.sections.map((item) => item.name)).toEqual(structureSections());
  });

  it('is guidance, never a gate: it writes only the score file and touches no issue, whatever the mark', async () => {
    for (const file of SKILL_FILES) {
      const text = await read(file);
      // Every git command that stages a file, other than the ones the skill forbids (`never \`git add -A\``).
      const added = [...text.matchAll(/(never `)?(git (?:add|rm)\b[^`\n]*)/gi)].filter((match) => match[1] === undefined).map((match) => match[2]);

      expect(text, file).not.toMatch(/gh issue (?:create|edit|close|comment|reopen)|gh api [^`\n]*issues/);
      expect(added.filter((command) => !/^git (?:add|rm --cached -q) \.grillo\/prd\/v<n>\.score\.json$/.test(command)), file).toEqual([]);
    }
    expect(sectionOf(await read('SKILL.md'), 'Guidance, never a gate')).toMatch(/nothing happens by itself/i);
  });

  it('is started by exactly one line in the PRD writer, where every version is saved', async () => {
    const writer = unixLines(await readFile(join(SKILLS_ROOT, 'grillo-prd', 'SKILL.md'), 'utf8'));
    const lines = writer.split('\n').filter((line) => line.includes('/grillo-score'));

    expect(lines).toHaveLength(1);
    expect(sectionOf(writer, 'Saving a version')).toContain(lines[0]);
  });
});

describe('the fixture of a project whose two PRD versions are scored', () => {
  it('scores every version: the eight criteria, then every structure section, with the overall the halves give', () => {
    const { versions, scores } = checkScoreFixture(fixture);

    expect(scores.map((entry) => entry.number)).toEqual(versions.map((version) => version.number));
    for (const { score } of scores) {
      expect(score.criteria.map((item) => item.name)).toEqual([...CRITERIA]);
      expect(score.sections.map((item) => item.name)).toEqual(structureSections());
      expect(score.overall).toBe(overallOf(score.criteria.map((item) => item.mark), score.sections.map((item) => item.mark)));
    }
  });

  it('marks the version with a [no source] statement lower, naming that statement in its comment', () => {
    const [v1, v2] = checkScoreFixture(fixture).scores.map((entry) => entry.score);
    const flows = (score: typeof v1) => score.sections.find((item) => item.name === 'Flows');

    expect(v1.overall).toBeLessThan(v2.overall);
    expect(flows(v1)?.mark).toBeLessThan(flows(v2)?.mark ?? 0);
    expect(flows(v1)?.comment).toContain('[no source]');
  });

  it('adds only the score files to the project as the PRD writer left it: no ticket, fog line or version changes', async () => {
    const before = await readFiles(BEFORE_SCORING);
    const added = Object.keys(fixture).filter((path) => !(path in before));

    expect(added.sort()).toEqual([V1_SCORE, V2_SCORE]);
    for (const [path, text] of Object.entries(before)) {
      expect(fixture[path], path).toBe(text);
    }
  });

  it('works out the overall as two equal halves, each the plain mean of its marks, to one decimal', () => {
    expect(overallOf([8, 6, 7, 5, 9, 8, 6, 4], [6, 8, 7, 9])).toBe(7.1);
    expect(overallOf([10, 10, 10, 10, 10, 10, 10, 10], [0])).toBe(5);
    expect(overallOf([0, 0, 0, 0, 0, 0, 0, 1], [0, 0, 0])).toBe(0.1);
  });

  it('scores a structure section the version does not write as 0, and still reads an older score without it', () => {
    const structure = JSON.parse(fixture['.grillo/structure.json']) as { sections: { name: string; note: string }[] };
    structure.sections.push({ name: 'Costs', note: 'What the app costs the garden' });
    const withSection = {
      ...fixture,
      '.grillo/structure.json': JSON.stringify(structure),
      'issues/1.md': fixture['issues/1.md'].replace('### Fog\n', '### Fog\n- Costs: whether members pay a deposit\n'),
    };
    const scored = (mark: number) => {
      const score = JSON.parse(fixture[V2_SCORE]) as { overall: number; criteria: { mark: number }[]; sections: { name: string; mark: number; comment: string }[] };
      score.sections.push({ name: 'Costs', mark, comment: 'Not written: no decision yet. Suggestion: settle the fog line on deposits, then regenerate.' });
      score.overall = overallOf(score.criteria.map((item) => item.mark), score.sections.map((item) => item.mark));
      return { ...withSection, [V2_SCORE]: `${JSON.stringify(score, null, 2)}\n` };
    };

    expect(checkScoreFixture(withSection).scores).toHaveLength(2);
    expect(checkScoreFixture(scored(0)).scores[1].score.sections.at(-1)).toMatchObject({ name: 'Costs', mark: 0 });
    expect(() => checkScoreFixture(scored(3))).toThrow(/'Costs', which v2 does not write, is marked 3/);
  });
});

describe('the score checker, given a malformed score file', () => {
  const v2 = (): Record<string, unknown> => JSON.parse(fixture[V2_SCORE]) as Record<string, unknown>;
  const items = (field: 'criteria' | 'sections'): Record<string, unknown>[] => v2()[field] as Record<string, unknown>[];
  const withField = (field: string, value: unknown) => JSON.stringify({ ...v2(), [field]: value });
  const withItem = (field: 'criteria' | 'sections', index: number, change: Record<string, unknown>) =>
    withField(field, items(field).map((item, at) => (at === index ? { ...item, ...change } : item)));
  const withComment = (comment: string) => withItem('criteria', 0, { comment });

  it.each([
    ['text that is not JSON', '{ "overall": 7.1,'],
    ['null', 'null'],
    ['a list', '[]'],
    ['no overall', JSON.stringify({ criteria: items('criteria'), sections: items('sections') })],
    ['a null overall', withField('overall', null)],
    ['an overall as text', withField('overall', '7.1')],
    ['an overall the marks do not give', withField('overall', 7)],
    ['a null criteria list', withField('criteria', null)],
    ['a null criterion', withField('criteria', [null, ...items('criteria').slice(1)])],
    ['a criterion missing', withField('criteria', items('criteria').slice(1))],
    ['a criterion twice', withField('criteria', [items('criteria')[0], ...items('criteria')])],
    ['an unknown criterion', withItem('criteria', 0, { name: 'Beautiful' })],
    ['the criteria out of order', withField('criteria', [items('criteria')[1], items('criteria')[0], ...items('criteria').slice(2)])],
    ['a null section', withField('sections', [null, ...items('sections').slice(1)])],
    ['a section the version writes left unscored', withField('sections', items('sections').slice(1))],
    ['a section twice', withField('sections', [items('sections')[0], ...items('sections')])],
    ['the sections out of the version order', withField('sections', [items('sections')[1], items('sections')[0], ...items('sections').slice(2)])],
    ['a section with an empty name', withField('sections', [...items('sections'), { name: ' ', mark: 0, comment: 'Suggestion: none.' }])],
    ['a mark above 10', withItem('criteria', 0, { mark: 11 })],
    ['a mark below 0', withItem('sections', 0, { mark: -1 })],
    ['a mark with a fraction', withItem('criteria', 0, { mark: 6.5 })],
    ['a mark as text', withItem('criteria', 0, { mark: '8' })],
    ['a null mark', withItem('sections', 0, { mark: null })],
    ['a missing comment', withItem('criteria', 0, { comment: undefined })],
    ['a field the Score type lacks', withField('grade', 'B')],
    ['an item field the Score type lacks', withItem('criteria', 0, { weight: 1 })],
    ['an empty comment', withComment('  ')],
    ['a comment over two lines', withComment('Plain words.\nSuggestion: define "for good".')],
    ['a comment with no suggestion', withComment('Plain short statements.')],
    ['a comment holding a Grillo marker', withComment('<!-- grillo:appendix --> Suggestion: none.')],
    ['a comment citing a question the version never cites', withComment('Q9.1 is vague. Suggestion: reword it.')],
    ['a comment citing a source the version never cites', withComment('[S1] is vague. Suggestion: reword it.')],
  ])('refuses %s with a FixtureError only', (_case, text) => {
    expect(() => checkScoreFixture({ ...fixture, [V2_SCORE]: text })).toThrow(FixtureError);
  });

  it('refuses a score of a version that was never written', () => {
    expect(() => checkScoreFixture({ ...fixture, '.grillo/prd/v3.score.json': fixture[V2_SCORE] })).toThrow(/scores v3, which is not written/);
  });

  it.each([
    ['in brackets', 'The week limit [S3, Q2.3] has no exception. Suggestion: say what a late return costs.'],
    ['after a colon', 'Week limit:Q2.3 has no exception. Suggestion: say what a late return costs.'],
    ['after a hash or an equals sign', 'See #Q2.3 and limit=S3 for the week. Suggestion: say what a late return costs.'],
    ['at the end of a sentence', 'The week limit has no exception, see Q2.3. Suggestion: say what a late return costs.'],
  ])('reads the codes a comment cites %s, and accepts the ones the version cites', (_case, comment) => {
    expect(() => checkScoreFixture({ ...fixture, [V2_SCORE]: withComment(comment) })).not.toThrow();
    expect(() => checkScoreFixture({ ...fixture, [V2_SCORE]: withComment(comment.replace('Q2.3', 'Q2.9')) })).toThrow(/cites Q2\.9/);
  });

  it('does not read a longer word or number as a code', () => {
    expect(() => checkScoreFixture({ ...fixture, [V2_SCORE]: withComment('Specs like MS9 or Q2.3.4 and S99x are not codes. Suggestion: none.') })).not.toThrow();
  });
});
