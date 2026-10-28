import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { formatTagsByHand, isDomainLabel, NO_DOMAIN_LABEL, parseTagsByHand } from '../../../src/main/store/github/issues/bodies';
import { readCommandCatalogue } from '../catalogue';
import { checkProjectFixture, type CheckedFixture, readFixtureFolder } from '../fixture-check';

/**
 * The tagging round's skill file, checked without the model: the SKILL.md frontmatter and command against the
 * catalogue, the labels and the tags-by-hand marker it teaches against `docs/store-layout.md` and the store's own
 * parser, and fixtures of a project before a first round, after it and after a member joined and the round ran
 * again, against the store layout and the rules of a round. Live behaviour with the model is the demo's job.
 */

const SKILL_FOLDER = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = 'grillo-tagging';
const REPOSITORY_ROOT = join(SKILL_FOLDER, '..', '..', '..');
const FIXTURES = join(SKILL_FOLDER, 'fixtures');
const MEMBERS_FILE = '.grillo/members.json';
const MANIFEST = 'issues.json';

const read = (path: string): Promise<string> => readFile(join(SKILL_FOLDER, path), 'utf8').then((text) => text.replace(/\r\n/g, '\n'));
const readLayout = (): Promise<string> => readFile(join(REPOSITORY_ROOT, 'docs', 'store-layout.md'), 'utf8').then((text) => text.replace(/\r\n/g, '\n'));

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

/** One `## ` section of a Markdown file, up to the next one. */
function sectionOf(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  return start === -1 ? '' : markdown.slice(start + 1).split(/\n## /)[0];
}

const codeSpans = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

/** The header names a section lists as `- \`<name>:\`` bullets, in order. */
const headerBullets = (section: string): string[] => [...section.matchAll(/^- `([a-z-]+):`/gm)].map((match) => match[1]);

const FIXTURE_NAMES = ['before-round', 'after-first-round', 'after-member-joins'] as const;
/** The three fixtures, read once before the tests run. */
const fixtures: Record<(typeof FIXTURE_NAMES)[number], Record<string, string>> = Object.fromEntries(
  await Promise.all(FIXTURE_NAMES.map(async (name) => [name, await readFixtureFolder(join(FIXTURES, name))] as const)),
) as Record<(typeof FIXTURE_NAMES)[number], Record<string, string>>;

const domainLabels = (labels: string[]): string[] => labels.filter(isDomainLabel).sort();

/**
 * Every way a project after a tagging round breaks the rules of a round, given the project before it: only domain
 * labels change, closed tickets keep theirs, and every open ticket ends with at least one. A hand-tagged ticket whose
 * labels changed is refused by `checkProjectFixture` itself, since its labels no longer match its latest marker.
 * Members joining between the two snapshots is the round's input, not its output.
 */
function tagRoundProblems(beforeFiles: Record<string, string>, afterFiles: Record<string, string>): string[] {
  const problems: string[] = [];
  const before = checkProjectFixture(beforeFiles);
  const after = checkProjectFixture(afterFiles);

  for (const path of new Set([...Object.keys(beforeFiles), ...Object.keys(afterFiles)])) {
    if (path !== MANIFEST && path !== MEMBERS_FILE && beforeFiles[path] !== afterFiles[path]) {
      problems.push(`the round changed the file ${path}`);
    }
  }
  const withoutDomains = (fixture: CheckedFixture) =>
    JSON.stringify(fixture.tickets.map((ticket) => ({ ...ticket, labels: ticket.labels.filter((label) => !isDomainLabel(label)) })));
  if (withoutDomains(before) !== withoutDomains(after) || JSON.stringify(before.map) !== JSON.stringify(after.map)) {
    problems.push('the round changed something other than domain labels');
  }
  for (const ticket of after.tickets) {
    const earlier = before.tickets.find((candidate) => candidate.number === ticket.number);
    const kept = earlier !== undefined && domainLabels(earlier.labels).join() === domainLabels(ticket.labels).join();
    if (earlier?.state === 'closed' && !kept) {
      problems.push(`the round changed the tags of the closed ticket #${ticket.number}`);
    }
    if (ticket.state === 'open' && domainLabels(ticket.labels).length === 0) {
      problems.push(`the round left the open ticket #${ticket.number} with no domain label`);
    }
  }
  return problems;
}

/** A fixture's manifest with the domain labels of one ticket replaced. */
function relabelled(files: Record<string, string>, number: number, domains: string[]): Record<string, string> {
  const manifest = JSON.parse(files[MANIFEST]) as { tickets: { number: number; labels: string[] }[] };
  const ticket = manifest.tickets.find((candidate) => candidate.number === number);
  if (ticket === undefined) {
    throw new Error(`test setup: no ticket #${number}`);
  }
  ticket.labels = [...ticket.labels.filter((label) => !isDomainLabel(label)), ...domains];
  return { ...files, [MANIFEST]: JSON.stringify(manifest) };
}

describe('the grillo-tagging skill', () => {
  it('is named after its folder and answers the command the catalogue gives it', async () => {
    const skill = await read('SKILL.md');
    const frontmatter = frontmatterOf(skill);
    const entries = (await readCommandCatalogue()).filter((entry) => entry.folder === SKILL_NAME);

    expect(SKILL_FOLDER.endsWith(SKILL_NAME)).toBe(true);
    expect(frontmatter.name).toBe(SKILL_NAME);
    expect(entries.map((entry) => [entry.command, entry.kind, entry.release])).toEqual([['/grillo-tagging', 'grilling', 1]]);
    expect(entries[0].argument).toBe('');
    expect(frontmatter['argument-hint']).toBeUndefined();
    expect(frontmatter['disable-model-invocation']).toBe(true);
    expect(typeof frontmatter.description).toBe('string');
    expect(skill).toContain('`/grillo-tagging`');
  });

  it('names only commands the catalogue holds', async () => {
    const commands = new Set((await readCommandCatalogue()).map((entry) => entry.name));
    const named = [...(await read('SKILL.md')).matchAll(/\/(grillo-[a-z0-9-]+)/g)].map((match) => match[1]);

    expect(named.filter((name) => !commands.has(name))).toEqual([]);
  });

  it('points only at sections of its own file, never at the repository files a project folder lacks', async () => {
    const skill = await read('SKILL.md');
    const links = [...skill.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]).filter((target) => !/^[a-z]+:/.test(target));

    for (const link of links) {
      const [path, anchor] = link.split('#');
      if (path !== '') {
        const target = normalize(join(SKILL_FOLDER, path));
        expect(relative(SKILL_FOLDER, target).startsWith('..'), link).toBe(false);
        expect(existsSync(target), link).toBe(true);
      }
      if (path === '' && anchor !== undefined) {
        const headings = [...skill.matchAll(/^#{2,3} (.+)$/gm)].map((match) => match[1].toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-'));
        expect(headings, link).toContain(anchor);
      }
    }
    expect(skill).not.toMatch(/docs\/store-layout|resources\/skills|dev-next|new-issue\.md|docs\/PRDs/);
  });

  it('teaches the domain labels of the store layout and the four kind labels it reads tickets by', async () => {
    const labels = sectionOf(await readLayout(), 'Labels')
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .slice(2)
      .flatMap((line) => codeSpans(line.split('|')[1]));
    const skill = await read('SKILL.md');

    expect(labels).toEqual(expect.arrayContaining(['domain:<name>', NO_DOMAIN_LABEL]));
    for (const label of labels.filter((name) => name !== 'wayfinder:map')) {
      expect(skill, label).toContain(`\`${label}\``);
    }
  });

  it('teaches the tags-by-hand marker with the header lines the store layout gives, in their order', async () => {
    const layoutHeaders = headerBullets(sectionOf(await readLayout(), 'Tags set by hand'));
    const skillSection = sectionOf(await read('SKILL.md'), 'Tags set by hand');
    const tableRow = skillSection.split('\n').find((line) => line.startsWith('| `<!-- grillo:tags-by-hand -->`'));

    expect(layoutHeaders).toEqual(['who', 'when', 'domains']);
    expect(headerBullets(skillSection)).toEqual(layoutHeaders);
    expect(codeSpans(tableRow ?? '')).toEqual(['<!-- grillo:tags-by-hand -->', ...layoutHeaders.map((name) => `${name}:`)]);
  });

  it('shows the marker, in the skill and in the store layout, in a shape the store reads back unchanged', async () => {
    const examples = [...codeBlocksOf(await read('SKILL.md')), ...codeBlocksOf(sectionOf(await readLayout(), 'Tags set by hand'))].filter((block) =>
      block.startsWith('<!-- grillo:'),
    );

    expect(examples).toHaveLength(2);
    for (const example of examples) {
      expect(formatTagsByHand(parseTagsByHand(example, 'the marker example'))).toBe(example);
    }
  });
});

describe('the fixtures of a tagging round', () => {
  it('follow the store layout before the first round, after it and after a member joined and the round ran again', () => {
    for (const name of FIXTURE_NAMES) {
      expect(() => checkProjectFixture(fixtures[name]), name).not.toThrow();
    }
  });

  it('show a first round that tags every open ticket, leaves the hand-tagged and closed ones alone, and writes nothing else', () => {
    const before = checkProjectFixture(fixtures['before-round']);
    const after = checkProjectFixture(fixtures['after-first-round']);

    expect(before.tickets.filter((ticket) => ticket.state === 'open' && !ticket.tagsByHand).map((ticket) => domainLabels(ticket.labels))).toEqual([[], [], []]);
    expect(after.tickets.some((ticket) => ticket.labels.includes(NO_DOMAIN_LABEL))).toBe(true);
    expect(after.tickets.some((ticket) => ticket.tagsByHand !== null)).toBe(true);
    expect(tagRoundProblems(fixtures['before-round'], fixtures['after-first-round'])).toEqual([]);
  });

  it('show a round run again after a member joined giving their domain to a ticket that fitted nobody', () => {
    const before = checkProjectFixture(fixtures['after-first-round']);
    const after = checkProjectFixture(fixtures['after-member-joins']);
    const joined = JSON.parse(fixtures['after-member-joins'][MEMBERS_FILE]).length - JSON.parse(fixtures['after-first-round'][MEMBERS_FILE]).length;
    const retagged = after.tickets.filter((ticket) => before.tickets.find((earlier) => earlier.number === ticket.number)?.labels.includes(NO_DOMAIN_LABEL));

    expect(joined).toBe(1);
    expect(retagged.map((ticket) => domainLabels(ticket.labels))).toEqual([['domain:workshop']]);
    expect(tagRoundProblems(fixtures['after-first-round'], fixtures['after-member-joins'])).toEqual([]);
  });

  it('would refuse a round that changes the tags a member set by hand, which then disagree with the marker', () => {
    expect(() => tagRoundProblems(fixtures['before-round'], relabelled(fixtures['after-first-round'], 6, ['domain:product']))).toThrow(
      'ticket #6 carries [domain:product] where its latest tags-by-hand marker set [domain:developer] by hand',
    );
  });

  it.each<[string, (files: Record<string, string>) => Record<string, string>, string]>([
    ['tags a closed ticket', (files) => relabelled(files, 2, ['domain:product']), 'closed ticket #2'],
    ['leaves an open ticket with no domain label', (files) => relabelled(files, 4, []), '#4 with no domain label'],
    ['edits a ticket body', (files) => ({ ...files, 'issues/3.md': files['issues/3.md'].replace('Which roles do people have?', 'Which roles?') }), 'issues/3.md'],
    ['changes a kind label', (files) => ({ ...files, [MANIFEST]: files[MANIFEST].replace('"wayfinder:research"', '"wayfinder:task"') }), 'other than domain labels'],
  ])('would flag a round that %s', (_what, change, mentions) => {
    const problems = tagRoundProblems(fixtures['before-round'], change(fixtures['after-first-round']));

    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining(mentions)]));
  });
});
