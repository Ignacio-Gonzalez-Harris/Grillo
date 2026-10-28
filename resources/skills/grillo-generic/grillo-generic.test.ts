import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { type IssueComment, parseComment } from '../../../src/main/store/github/issues/bodies';
import { parseSource } from '../../../src/main/store/github/repo/records';
import { readCommandCatalogue } from '../catalogue';
import { checkProjectFixture, readFixtureFolder } from '../fixture-check';

/**
 * The generic agent's skill file, checked without the model: the SKILL.md frontmatter and command against the
 * catalogue, the records it teaches against the store's own parsers and `docs/store-layout.md`, and fixtures of a
 * project before and after a member pasted a customer email that clashed with a recorded answer, against the store
 * layout and the rules of a generic agent: every change marked, nothing earlier rewritten. Live behaviour with the
 * model is the demo's job.
 */

const SKILL_FOLDER = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = 'grillo-generic';
const SKILLS_ROOT = join(SKILL_FOLDER, '..');
const REPOSITORY_ROOT = join(SKILLS_ROOT, '..', '..');
const FIXTURES = join(SKILL_FOLDER, 'fixtures');
const MANIFEST = 'issues.json';
const SOURCES_FOLDER = '.grillo/sources/';
/** The member who ran the generic agent in the fixtures. */
const MEMBER = 'ben-example';

const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');
const read = (path: string): Promise<string> => readFile(join(SKILL_FOLDER, path), 'utf8').then(unixLines);
const readLayout = (): Promise<string> => readFile(join(REPOSITORY_ROOT, 'docs', 'store-layout.md'), 'utf8').then(unixLines);

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

/** The mark every change a generic agent makes carries, where the record has no `via:` header line of its own. */
const markOf = (login: string): RegExp => new RegExp(`\\(${login}, via generic agent, \\d{4}-\\d{2}-\\d{2}\\)$`);

const FIXTURE_NAMES = ['before-email', 'after-email'] as const;
/** The two fixtures, read once before the tests run. */
const fixtures: Record<(typeof FIXTURE_NAMES)[number], Record<string, string>> = Object.fromEntries(
  await Promise.all(
    FIXTURE_NAMES.map(async (name) => [name, Object.fromEntries(Object.entries(await readFixtureFolder(join(FIXTURES, name))).map(([path, text]) => [path, unixLines(text)]))] as const),
  ),
) as Record<(typeof FIXTURE_NAMES)[number], Record<string, string>>;

interface RawCommentEntry {
  id: string;
  author: string;
  body: string;
}

/** The manifest's comments of every ticket, each with its author and body text. */
function commentsOf(files: Record<string, string>): Map<string, RawCommentEntry & { ticket: number; text: string }> {
  const manifest = JSON.parse(files[MANIFEST]) as { tickets: { number: number; comments: RawCommentEntry[] }[] };
  return new Map(manifest.tickets.flatMap((ticket) => ticket.comments.map((comment) => [comment.id, { ...comment, ticket: ticket.number, text: files[comment.body] }] as const)));
}

/**
 * Every way a project after a generic agent's run breaks the rules of a generic agent, given the project before it:
 * nothing earlier is rewritten or removed (files, comments, questions, labels, the destination), every comment the
 * run posts is a marked record `via: generic-agent` written as the member, every answer is followed by its
 * discussion, and every other change (a ticket, a question, a fog, out-of-scope or notes line) ends with the mark.
 */
function genericRunProblems(beforeFiles: Record<string, string>, afterFiles: Record<string, string>, member: string): string[] {
  const problems: string[] = [];
  const before = checkProjectFixture(beforeFiles);
  const after = checkProjectFixture(afterFiles);
  const mark = markOf(member);

  // Files: sources are only added, and nothing else in the Grillo folder changes.
  for (const path of new Set([...Object.keys(beforeFiles), ...Object.keys(afterFiles)])) {
    const isRecordFile = path === MANIFEST || path.startsWith('issues/') || path.startsWith('comments/');
    if (isRecordFile || beforeFiles[path] === afterFiles[path]) {
      continue;
    }
    if (beforeFiles[path] !== undefined || !path.startsWith(SOURCES_FOLDER)) {
      problems.push(`the run changed or removed the file ${path}`);
    }
  }
  for (const source of after.sources.filter((candidate) => !before.sources.some((earlier) => earlier.code === candidate.code))) {
    if (source.who.trim() === '' || source.where.trim() === '' || source.text.trim() === '') {
      problems.push(`the new source ${source.code} lacks who, where or its text`);
    }
  }

  // Comments: earlier ones untouched; new ones marked, as the member, every answer followed by its discussion.
  const earlierComments = commentsOf(beforeFiles);
  const laterComments = commentsOf(afterFiles);
  for (const [id, comment] of earlierComments) {
    if (laterComments.get(id)?.text !== comment.text) {
      problems.push(`the run changed or removed comment ${id}`);
    }
  }
  for (const ticket of after.tickets) {
    const added = ticket.comments.filter((comment) => !earlierComments.has(comment.id));
    added.forEach((comment: IssueComment, index) => {
      if (comment.kind !== 'answer' && comment.kind !== 'discussion' && comment.kind !== 'decision') {
        problems.push(`comment ${comment.id} is not an answer, a discussion or a decision`);
        return;
      }
      if (comment.via !== 'generic-agent' || comment.who !== member || laterComments.get(comment.id)?.author !== member) {
        problems.push(`comment ${comment.id} is not marked as ${member}'s, via generic-agent`);
      }
      if (comment.kind === 'answer' && !added.slice(index + 1).some((later) => later.kind === 'discussion' && later.question === comment.question)) {
        problems.push(`the answer ${comment.id} to ${comment.question} has no discussion after it`);
      }
    });
  }

  // Tickets: new ones marked and untagged; earlier ones keep their labels, wording and question texts.
  for (const ticket of after.tickets) {
    const earlier = before.tickets.find((candidate) => candidate.number === ticket.number);
    if (earlier === undefined) {
      if (!mark.test(ticket.body.whyItMatters)) {
        problems.push(`the new ticket #${ticket.number} has no mark at the end of its Why it matters`);
      }
      if (ticket.labels.length !== 1) {
        problems.push(`the new ticket #${ticket.number} carries labels beyond its kind`);
      }
      continue;
    }
    if (earlier.labels.join() !== ticket.labels.join() || earlier.body.question !== ticket.body.question || earlier.body.whyItMatters !== ticket.body.whyItMatters) {
      problems.push(`the run changed the labels, the question or the Why it matters of ticket #${ticket.number}`);
    }
    for (const line of ticket.body.questions) {
      const old = earlier.body.questions.find((candidate) => candidate.k === line.k);
      if (old === undefined && (line.text === null || !mark.test(line.text))) {
        problems.push(`the new question Q${ticket.number}.${line.k} has no mark`);
      }
      if (old !== undefined && old.text !== line.text && line.text !== null) {
        problems.push(`the run reworded Q${ticket.number}.${line.k}`);
      }
    }
    for (const assumption of ticket.body.assumptions.filter((line) => !earlier.body.assumptions.includes(line))) {
      if (!mark.test(assumption)) {
        problems.push(`the new assumption '${assumption}' on ticket #${ticket.number} has no mark`);
      }
    }
    if (earlier.state === 'closed' && ticket.state === 'open') {
      problems.push(`the run reopened ticket #${ticket.number}; a clash with a decision opens a Revisit ticket instead`);
    }
  }

  // The map: the destination stays; added lines carry the mark; a fog line taken off is noted, marked.
  if (before.map.destination !== after.map.destination) {
    problems.push('the run changed the destination');
  }
  const addedLines = (earlier: string[], later: string[]) => later.filter((line) => !earlier.includes(line));
  const earlierNotes = before.map.notes.split('\n');
  const addedNotes = after.map.notes.split('\n').filter((line) => !earlierNotes.includes(line));
  if (!before.map.notes.split('\n').every((line) => after.map.notes.split('\n').includes(line))) {
    problems.push('the run removed a line from the Notes');
  }
  for (const line of [...addedLines(before.map.fog, after.map.fog), ...addedLines(before.map.outOfScope, after.map.outOfScope), ...addedNotes]) {
    if (!mark.test(line.trim())) {
      problems.push(`the map line '${line}' has no mark`);
    }
  }
  for (const line of addedLines(after.map.fog, before.map.fog)) {
    if (!addedNotes.some((note) => note.startsWith(`Fog line taken off: ${line}`))) {
      problems.push(`the fog line '${line}' was taken off with no Notes line saying so`);
    }
  }
  return problems;
}

/** A fixture with one file's text changed, or added when it was missing. */
const withFile = (files: Record<string, string>, path: string, change: (text: string) => string): Record<string, string> => ({ ...files, [path]: change(files[path] ?? '') });

describe('the grillo-generic skill', () => {
  it('is named after its folder and answers the command the catalogue gives it, in a generic agent', async () => {
    const skill = await read('SKILL.md');
    const frontmatter = frontmatterOf(skill);
    const entries = (await readCommandCatalogue()).filter((entry) => entry.folder === SKILL_NAME);

    expect(SKILL_FOLDER.endsWith(SKILL_NAME)).toBe(true);
    expect(frontmatter.name).toBe(SKILL_NAME);
    expect(entries.map((entry) => [entry.command, entry.kind, entry.release])).toEqual([['/grillo-generic', 'generic', 1]]);
    expect(entries[0].argument).toBe('');
    expect(frontmatter['argument-hint']).toBeUndefined();
    expect(frontmatter['disable-model-invocation']).toBe(true);
    expect(typeof frontmatter.description).toBe('string');
    expect(skill).toContain('`/grillo-generic`');
  });

  it('names only commands the catalogue holds', async () => {
    const commands = new Set((await readCommandCatalogue()).map((entry) => entry.name));
    const named = [...(await read('SKILL.md')).matchAll(/\/(grillo-[a-z0-9-]+)/g)].map((match) => match[1]);

    expect(named.filter((name) => !commands.has(name))).toEqual([]);
  });

  it('points only at files Grillo ships into the project folder, never at repository files a project lacks', async () => {
    const skill = await read('SKILL.md');
    const links = [...skill.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((match) => match[1]).filter((target) => !/^[a-z]+:/.test(target));

    for (const link of links) {
      const target = normalize(join(SKILL_FOLDER, link));
      expect(relative(SKILL_FOLDER, target).startsWith('..'), link).toBe(false);
      expect(existsSync(target), link).toBe(true);
    }
    for (const [, shipped] of skill.matchAll(/\.claude\/skills\/(grillo-[a-z0-9-]+\/[^`\s]+)/g)) {
      expect(existsSync(join(SKILLS_ROOT, shipped)), `.claude/skills/${shipped}`).toBe(true);
    }
    expect(skill).not.toMatch(/docs\/store-layout|resources\/skills|dev-next|new-issue\.md|docs\/PRDs/);
  });

  it('follows only grillo-wayfinder and record-answer sections that exist, by their heading', async () => {
    const headingsOf = async (path: string) =>
      new Set([...unixLines(await readFile(join(SKILLS_ROOT, 'grillo-wayfinder', path), 'utf8')).matchAll(/^#{2,3} (.+?)(?: \(.*\))?$/gm)].map((match) => match[1]));
    const wayfinder = await headingsOf('SKILL.md');
    const recordAnswer = await headingsOf('references/record-answer.md');
    const skill = await read('SKILL.md');
    const named = (file: string) => [...skill.matchAll(new RegExp(`\`${file}\`, "([^"]+)"`, 'g'))].map((match) => match[1].replace(/\s+/g, ' '));

    expect(named('grillo-wayfinder')).toEqual(expect.arrayContaining(['Step 0: check GitHub and the project folder', 'The map-done rule']));
    expect(named('record-answer.md')).toEqual(expect.arrayContaining(['Step 1: the contradiction check', 'Step 2: the source file']));
    expect(named('grillo-wayfinder').filter((name) => !wayfinder.has(name))).toEqual([]);
    expect(named('record-answer.md').filter((name) => !recordAnswer.has(name))).toEqual([]);
  });

  it('marks its comments with the via value the store layout gives a generic agent', async () => {
    const layout = await readLayout();
    const skill = await read('SKILL.md');

    expect(layout).toMatch(/`generic-agent` when recorded by a generic agent/);
    expect(skill).toContain('`via: generic-agent`');
    expect(skill).toContain('(<login>, via generic agent, <YYYY-MM-DD>)');
  });

  it('asks for every header line of a source, for pasted material and for the member own words', async () => {
    const skill = await read('SKILL.md');

    for (const words of ['`kind:`', '`who:`', '`when:`', '`where:`', '`pasted-text`', '`document`', '`own-time-answer`']) {
      expect(skill, words).toContain(words);
    }
  });

  it('shows every record in a shape the store reads back, marked as a generic agent writes it', async () => {
    const blocks = codeBlocksOf(await read('SKILL.md'));
    const comments = blocks.filter((block) => block.startsWith('<!-- grillo:')).map((body, index) => parseComment({ id: String(index + 1), author: MEMBER, createdAt: '2026-10-26T10:07:00.000Z', body }));
    const sources = blocks.filter((block) => block.startsWith('kind: ')).map((block, index) => parseSource(block, `S${index + 4}`, 'the source example'));

    expect(comments.map((comment) => comment.kind)).toEqual(['answer', 'discussion']);
    for (const comment of comments) {
      expect(comment.kind !== 'plain' && comment.kind !== 'other' && comment.via).toBe('generic-agent');
    }
    expect(sources.map((source) => source.kind)).toEqual(['pasted-text', 'own-time-answer']);
  });
});

describe('the fixtures of a generic agent run: a pasted email that clashed with a recorded answer', () => {
  it('follow the store layout before the email and after the run', () => {
    for (const name of FIXTURE_NAMES) {
      expect(() => checkProjectFixture(fixtures[name]), name).not.toThrow();
    }
  });

  it('show the email kept word for word as a new source, and the clashing answer changed, marked and discussed', () => {
    const before = checkProjectFixture(fixtures['before-email']);
    const after = checkProjectFixture(fixtures['after-email']);
    const newSources = after.sources.filter((source) => !before.sources.some((earlier) => earlier.code === source.code));
    const answersTo = (fixture: typeof after, question: string) =>
      fixture.tickets.flatMap((ticket) => ticket.comments).filter((comment) => comment.kind === 'answer' && comment.question === question);
    const [earlier] = answersTo(before, 'Q3.1');
    const [, changed] = answersTo(after, 'Q3.1');

    expect(newSources.map((source) => source.kind)).toEqual(['pasted-text', 'own-time-answer']);
    expect(earlier?.kind === 'answer' && earlier.text).toContain('Only members who hold a key card');
    expect(changed).toMatchObject({ kind: 'answer', via: 'generic-agent', who: MEMBER, sources: newSources.map((source) => source.code) });
    expect(genericRunProblems(fixtures['before-email'], fixtures['after-email'], MEMBER)).toEqual([]);
  });

  it('show the discussion keeping the member words that settled the clash, word for word as their own source holds them', () => {
    const after = checkProjectFixture(fixtures['after-email']);
    const discussion = after.tickets.flatMap((ticket) => ticket.comments).find((comment) => comment.kind === 'discussion' && comment.via === 'generic-agent');
    const ownWords = after.sources.find((source) => source.kind === 'own-time-answer' && source.where.includes('generic agent'));

    expect(discussion?.kind === 'discussion' && discussion.session).toBeNull();
    expect(discussion?.kind === 'discussion' && discussion.transcript).toContain(ownWords?.text.trim());
  });

  it('show the fog line the email made precise turned into a marked ticket, the line noted as taken off', () => {
    const before = checkProjectFixture(fixtures['before-email']);
    const after = checkProjectFixture(fixtures['after-email']);
    const newTickets = after.tickets.filter((ticket) => !before.tickets.some((earlier) => earlier.number === ticket.number));

    expect(before.map.fog).toHaveLength(1);
    expect(after.map.fog).toEqual([]);
    expect(newTickets.map((ticket) => [ticket.kind, ticket.state, ticket.body.whyItMatters.split(':')[0]])).toEqual([['grilling', 'open', 'Users and roles']]);
    expect(after.mapDone).toBe(false);
  });

  it.each<[string, (files: Record<string, string>) => Record<string, string>, string]>([
    ['posts an answer with no via mark', (files) => withFile(files, 'comments/3003.md', (text) => text.replace('via: generic-agent', 'via:')), 'comment 3003 is not marked'],
    [
      'records an answer with no discussion after it',
      (files) => withFile(files, MANIFEST, (text) => text.replace(/,\s*\{ "id": "3004"[^}]*\}/, '')),
      'the answer 3003 to Q3.1 has no discussion',
    ],
    ['edits an earlier answer instead of adding one', (files) => withFile(files, 'comments/3002.md', (text) => text.replace('Only members', 'Members and guests')), 'changed or removed comment 3002'],
    ['rewrites an earlier source', (files) => withFile(files, '.grillo/sources/S1.md', (text) => `${text}More words.\n`), 'the file .grillo/sources/S1.md'],
    ['opens a ticket with no mark', (files) => withFile(files, 'issues/5.md', (text) => text.replace(/ \(ben-example, via generic agent, 2026-10-26\)/, '')), 'new ticket #5 has no mark'],
    ['adds a fog line with no mark', (files) => withFile(files, 'issues/1.md', (text) => text.replace('### Fog\n', '### Fog\n- Flows: whether guests return tools to the same shed\n')), 'has no mark'],
    [
      'takes a fog line off with no Notes line',
      (files) => withFile(files, 'issues/1.md', (text) => text.replace(/\nFog line taken off:.*\n/, '\n')),
      'was taken off with no Notes line',
    ],
    ['rewords an earlier question', (files) => withFile(files, 'issues/3.md', (text) => text.replace('Who may lend a tool?', 'Who may lend tools?')), 'reworded Q3.1'],
  ])('would flag a run that %s', (_what, change, mentions) => {
    const problems = genericRunProblems(fixtures['before-email'], change(fixtures['after-email']), MEMBER);

    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining(mentions)]));
  });
});
