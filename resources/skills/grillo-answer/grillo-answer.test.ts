import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { type AnswerComment, type MarkedComment, parseComment } from '../../../src/main/store/github/issues/bodies';
import { parseSource } from '../../../src/main/store/github/repo/records';
import { sameLogin } from '../../../src/main/store/github/repo/names';
import { readCommandCatalogue } from '../catalogue';
import { checkProjectFixture, type CheckedTicket, readFixtureFolder } from '../fixture-check';

/**
 * The own-time answering skill, checked without the model: the SKILL.md frontmatter and its two commands against the
 * catalogue, the screen messages it handles against the catalogue's protocol, the records it shows against the
 * store's own parsers and grillo-wayfinder's record-answer reference, and fixtures of one project through two
 * own-time chats and two comment pickups against the store layout and the rules of each run. Live behaviour with the
 * model is the demo's job.
 */

const SKILL_FOLDER = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = 'grillo-answer';
const SKILLS_ROOT = join(SKILL_FOLDER, '..');
const FIXTURES = join(SKILL_FOLDER, 'fixtures');
const MANIFEST = 'issues.json';
const MEMBERS_FILE = '.grillo/members.json';
const RUNNER = 'ada-example';

const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');
const read = (path: string): Promise<string> => readFile(join(SKILL_FOLDER, path), 'utf8').then(unixLines);
const readSkill = (path: string): Promise<string> => readFile(join(SKILLS_ROOT, path), 'utf8').then(unixLines);

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

/** The cells of the table rows in a piece of Markdown, the header and divider left out. */
function tableRows(markdown: string): string[][] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => line.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim()));
}

const codeSpans = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

/** A heading's name: its text before any ` (...)` note, so `Working a ticket (the engine ...)` is `Working a ticket`. */
const headingNames = (markdown: string): Set<string> => new Set([...markdown.matchAll(/^#{2,3} (.+?)(?: \(.*\))?$/gm)].map((match) => match[1]));

/** The GitHub anchor of a heading. */
const anchorOf = (heading: string): string => heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');

/** The keyword of a protocol control line: `present: <logins>` is `present:`, `jump <ticket number>` is `jump`. */
const keywordOf = (controlLine: string): string => /^[a-z]+:|^[a-z ]+?(?= <|$)/.exec(controlLine)?.[0] ?? controlLine;

// The fixtures: one made-up project through two own-time chats and two comment pickups, each run by ada-example.

const FIXTURE_NAMES = ['before', 'after-own-time-release', 'after-own-time-close', 'after-pickup', 'after-last-pickup'] as const;
type FixtureName = (typeof FIXTURE_NAMES)[number];
const fixtures = Object.fromEntries(
  await Promise.all(FIXTURE_NAMES.map(async (name) => [name, await readFixtureFolder(join(FIXTURES, name))] as const)),
) as Record<FixtureName, Record<string, string>>;

type Run = { mode: 'own-time'; ticket: number } | { mode: 'pickup' };

interface RunOutcome {
  /** Every way the run broke the rules of its mode. */
  problems: string[];
  /** The tickets the run closed. */
  closed: number[];
  /** The run closed a ticket and left no open ticket and no fog: the map-done rule starts `/grillo-prd`. */
  prdDue: boolean;
}

const COMMENT_FILE = /^comments\/[1-9]\d*\.md$/;
const SOURCE_FILE = /^\.grillo\/sources\/S[1-9]\d*\.md$/;
const isLiveAnswered = (ticket: CheckedTicket, k: number): boolean =>
  ticket.comments.some((comment) => comment.kind === 'answer' && comment.question === `Q${ticket.number}.${k}`);
const everyQuestionAnswered = (ticket: CheckedTicket): boolean =>
  ticket.body.questions.filter((question) => question.text !== null).every((question) => isLiveAnswered(ticket, question.k));

/**
 * What one run of the skill by the runner did to a project, given the project before and after it, both already
 * checked against the store layout by `checkProjectFixture`. Plain comments members wrote in GitHub's own app
 * between the two snapshots are the run's input, not its output.
 */
function answerRun(beforeFiles: Record<string, string>, afterFiles: Record<string, string>, run: Run): RunOutcome {
  const problems: string[] = [];
  const before = checkProjectFixture(beforeFiles);
  const after = checkProjectFixture(afterFiles);
  const members = (JSON.parse(afterFiles[MEMBERS_FILE]) as { login: string }[]).map((member) => member.login);
  const earlierSources = new Set(before.sources.map((source) => source.code));
  const sourceOf = (code: string) => after.sources.find((source) => source.code === code);

  for (const path of Object.keys(beforeFiles)) {
    const mayChange = path === MANIFEST || /^issues\/[1-9]\d*\.md$/.test(path);
    if (!mayChange && beforeFiles[path] !== afterFiles[path]) {
      problems.push(`the run changed the file ${path}`);
    }
  }
  for (const path of Object.keys(afterFiles).filter((name) => !(name in beforeFiles))) {
    if (!COMMENT_FILE.test(path) && !SOURCE_FILE.test(path)) {
      problems.push(`the run wrote the file ${path}, which is no source and no comment`);
    }
  }
  if (after.map.destination !== before.map.destination || after.map.notes !== before.map.notes) {
    problems.push('the run changed the map destination or notes');
  }

  const closed: number[] = [];
  for (const earlier of before.tickets) {
    const ticket = after.tickets.find((candidate) => candidate.number === earlier.number);
    if (ticket === undefined) {
      problems.push(`ticket #${earlier.number} is gone`);
      continue;
    }
    const name = `ticket #${ticket.number}`;
    if ([...earlier.labels].sort().join() !== [...ticket.labels].sort().join()) {
      problems.push(`the run changed the labels of ${name}`);
    }
    for (const question of earlier.body.questions) {
      const now = ticket.body.questions.find((line) => line.k === question.k);
      if (now === undefined || (now.text !== null && now.text !== question.text)) {
        problems.push(`the run changed or dropped question Q${ticket.number}.${question.k}`);
      }
    }
    for (const comment of earlier.comments) {
      if (!ticket.comments.some((other) => JSON.stringify(other) === JSON.stringify(comment))) {
        problems.push(`the run edited or deleted comment ${comment.id} on ${name}`);
      }
    }
    if (earlier.state === 'closed' && ticket.state === 'open') {
      problems.push(`the run reopened ${name}`);
    }
    if (earlier.state === 'open' && ticket.state === 'closed') {
      closed.push(ticket.number);
    }

    const added = ticket.comments.filter((comment) => !earlier.comments.some((other) => other.id === comment.id));
    const marked = added.filter((comment): comment is MarkedComment => comment.kind !== 'plain' && comment.kind !== 'other');
    const answers = marked.filter((comment): comment is AnswerComment => comment.kind === 'answer');
    for (const comment of added) {
      if (comment.kind === 'plain' && sameLogin(comment.author, RUNNER)) {
        problems.push(`the run wrote the plain comment ${comment.id} on ${name}; it records answers with a marker only`);
      }
    }
    for (const comment of marked) {
      if (!sameLogin(comment.who, RUNNER)) {
        problems.push(`comment ${comment.id} on ${name} was recorded by ${comment.who}, not by the member running the agent`);
      }
    }

    if (run.mode === 'own-time') {
      if (ticket.number !== run.ticket) {
        if (marked.length > 0 || ticket.state !== earlier.state || ticket.assignee !== earlier.assignee) {
          problems.push(`the run wrote on ${name}, which it was not started on`);
        }
        continue;
      }
      for (const comment of marked) {
        if (comment.via !== null || (comment.kind === 'answer' && comment.from !== null)) {
          problems.push(`comment ${comment.id} on ${name}, recorded in an own-time chat, is marked as turned from GitHub or another agent`);
        }
        for (const source of comment.sources.filter((code) => !earlierSources.has(code)).map(sourceOf)) {
          if (source?.kind === 'own-time-answer' && source.where !== `Grillo, own-time chat on ticket #${ticket.number}`) {
            problems.push(`source ${source.code} says it came from '${source.where}', not from the own-time chat on ${name}`);
          }
        }
        if (comment.kind === 'discussion') {
          const words = comment.sources.flatMap((code) => sourceOf(code)?.text.split('\n') ?? []).filter((line) => line.trim() !== '');
          if (!words.every((line) => comment.transcript.includes(line))) {
            problems.push(`discussion ${comment.id} on ${name} does not keep the member's words of its source word for word`);
          }
        }
      }
      if (ticket.state === 'open' && ticket.assignee !== null) {
        problems.push(`the run left ${name} held by ${ticket.assignee} after done, with questions still open`);
      }
      if (ticket.state === 'open' && everyQuestionAnswered(ticket)) {
        problems.push(`the run left ${name} open with every question answered`);
      }
      continue;
    }

    if (ticket.assignee !== earlier.assignee) {
      problems.push(`the pickup changed who holds ${name}`);
    }
    for (const comment of marked) {
      if (comment.kind === 'discussion') {
        problems.push(`the pickup wrote the discussion ${comment.id} on ${name}; a picked-up answer gets the answer comment only`);
      }
      if (comment.kind === 'decision' && comment.via !== 'github') {
        problems.push(`the pickup wrote the decision ${comment.id} on ${name} without via: github`);
      }
    }
    for (const answer of answers) {
      const origin = ticket.comments.find((comment) => comment.id === answer.from);
      if (answer.via !== 'github' || origin?.kind !== 'plain') {
        problems.push(`answer ${answer.id} on ${name} is not marked via: github with the plain comment it came from`);
        continue;
      }
      if (!members.some((login) => sameLogin(login, origin.author))) {
        problems.push(`answer ${answer.id} on ${name} comes from ${origin.author}, who is no member`);
      }
      const sources = answer.sources.map(sourceOf);
      const source = sources[0];
      if (sources.length !== 1 || source === undefined) {
        problems.push(`answer ${answer.id} on ${name} cites ${answer.sources.length} sources; a picked-up answer cites its comment's one source`);
        continue;
      }
      const expected = { kind: 'own-time-answer', when: origin.when, where: `GitHub comment ${origin.id} on ticket #${ticket.number}`, text: origin.text.trim() };
      const actual = { kind: source.kind, when: source.when, where: source.where, text: source.text.trim() };
      if (JSON.stringify(actual) !== JSON.stringify(expected) || !sameLogin(source.who, origin.author)) {
        problems.push(`source ${source.code} of answer ${answer.id} is not comment ${origin.id} word for word, by its author, at its date`);
      }
    }
    if (answers.length > 0 && ticket.state === 'open' && everyQuestionAnswered(ticket)) {
      problems.push(`the pickup left ${name} open with every question answered`);
    }
  }
  return { problems, closed, prdDue: closed.length > 0 && after.mapDone };
}

/** A fixture with one file's text changed. */
const edited = (files: Record<string, string>, path: string, from: string, to: string): Record<string, string> => {
  if (!unixLines(files[path] ?? '').includes(from)) {
    throw new Error(`test setup: ${path} does not hold '${from}'`);
  }
  return { ...files, [path]: unixLines(files[path]).replace(from, to) };
};

describe('the grillo-answer skill', () => {
  it('is named after its folder and answers the two commands the catalogue gives it', async () => {
    const skill = await read('SKILL.md');
    const frontmatter = frontmatterOf(skill);
    const entries = (await readCommandCatalogue()).filter((entry) => entry.folder === SKILL_NAME);

    expect(SKILL_FOLDER.endsWith(SKILL_NAME)).toBe(true);
    expect(frontmatter.name).toBe(SKILL_NAME);
    expect(entries.map((entry) => [entry.command, entry.kind, entry.release])).toEqual([
      ['/grillo-answer <ticket number>', 'grilling', 1],
      ['/grillo-answer pickup', 'grilling', 1],
    ]);
    expect(frontmatter['disable-model-invocation']).toBe(true);
    expect(typeof frontmatter.description).toBe('string');
    for (const entry of entries) {
      expect(skill, entry.command).toContain(`\`${entry.command}\``);
      expect(frontmatter['argument-hint'] as string, entry.command).toContain(entry.argument);
    }
  });

  it('names only commands the catalogue holds', async () => {
    const commands = new Set((await readCommandCatalogue()).map((entry) => entry.name));
    const named = [...(await read('SKILL.md')).matchAll(/\/(grillo-[a-z0-9-]+)/g)].map((match) => match[1]);

    expect(named.filter((name) => !commands.has(name))).toEqual([]);
  });

  it('points only at its own sections and at files Grillo ships into the project folder', async () => {
    const skill = await read('SKILL.md');
    const anchors = new Set([...skill.matchAll(/^#{2,3} (.+)$/gm)].map((match) => anchorOf(match[1])));
    const links = [...skill.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]).filter((target) => !/^[a-z]+:/.test(target));

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const [path, anchor] = link.split('#');
      if (path === '') {
        expect(anchors, link).toContain(anchor);
      } else {
        const target = normalize(join(SKILL_FOLDER, path));
        expect(relative(SKILL_FOLDER, target).startsWith('..'), link).toBe(false);
        expect(existsSync(target), link).toBe(true);
      }
    }
    for (const [, shipped] of skill.matchAll(/\.claude\/skills\/(grillo-[a-z0-9-]+\/[^`\s]+)/g)) {
      expect(existsSync(join(SKILLS_ROOT, shipped)), `.claude/skills/${shipped}`).toBe(true);
    }
    expect(skill).not.toMatch(/docs\/store-layout|resources\/skills|dev-next|new-issue\.md|docs\/PRDs/);
  });

  it('follows only grillo-wayfinder and record-answer sections that exist, by their heading', async () => {
    const skill = (await read('SKILL.md')).replace(/\s+/g, ' ');
    const wayfinder = headingNames(await readSkill('grillo-wayfinder/SKILL.md'));
    const recordAnswer = headingNames(await readSkill('grillo-wayfinder/references/record-answer.md'));
    const namedIn = (pattern: RegExp): string[] => [...skill.matchAll(pattern)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((name) => name[1]));
    const wayfinderNames = namedIn(/\(`grillo-wayfinder`, ([^)]*)\)/g);
    const recordAnswerNames = namedIn(/\(record-answer\.md, ([^)]*)\)/g);

    expect(wayfinderNames).toEqual(expect.arrayContaining(['Claiming a ticket', 'The map-done rule', 'Working a ticket']));
    expect(wayfinderNames.filter((name) => !wayfinder.has(name))).toEqual([]);
    expect(recordAnswerNames.length).toBeGreaterThan(0);
    expect(recordAnswerNames.filter((name) => !recordAnswer.has(name))).toEqual([]);
  });

  it('handles every screen message the catalogue sends it, and turns away the meeting-only ones', async () => {
    const protocol = tableRows(sectionOf(await readSkill('README.md'), 'Screen-to-agent protocol'));
    const handled = tableRows(sectionOf(await read('SKILL.md'), 'Messages from Grillo\'s screens'));
    const rowFor = (keyword: string) => handled.find((row) => codeSpans(row[0]).map(keywordOf).includes(keyword));

    expect(protocol.length).toBeGreaterThan(0);
    for (const [, controlCell, , acceptedBy] of protocol) {
      const keyword = keywordOf(codeSpans(controlCell)[0]);
      const accepted = acceptedBy.includes('`/grillo-answer <ticket number>`') || acceptedBy === 'Every agent';
      const row = rowFor(keyword);

      expect(row, keyword).toBeDefined();
      expect(row?.[1].includes('never to an own-time chat'), keyword).toBe(!accepted);
    }
  });

  it('teaches the sources of record-answer.md for a chat answer and a picked-up GitHub comment', async () => {
    const reference = await readSkill('grillo-wayfinder/references/record-answer.md');
    const rows = tableRows(sectionOf(reference, 'Step 2: the source file'));
    const row = (where: string) => rows.find((cells) => cells[0].startsWith(where)) ?? [];
    const skill = await read('SKILL.md');

    for (const [, kind, , , whereCell] of [row('The member, in a chat'), row("A member's comment written in GitHub's own app")]) {
      expect(skill).toContain(`\`kind: ${codeSpans(kind)[0]}\``);
      expect(skill).toContain(`\`${codeSpans(whereCell)[0]}\``);
    }
  });

  it('shows a picked-up source and answer in a shape the store reads back, naming the comment and who recorded it', async () => {
    const blocks = codeBlocksOf(await read('SKILL.md'));
    const [sourceText] = blocks.filter((block) => block.startsWith('kind: '));
    const [answerText] = blocks.filter((block) => block.startsWith('<!-- grillo:'));
    const source = parseSource(sourceText, 'S4', 'the source example');
    const answer = parseComment({ id: '3002', author: RUNNER, createdAt: '2026-10-24T16:01:00.000Z', body: answerText });

    expect(blocks.filter((block) => block.startsWith('kind: ') || block.startsWith('<!-- grillo:'))).toHaveLength(2);
    expect(answer).toMatchObject({ kind: 'answer', who: RUNNER, sources: ['S4'], via: 'github', from: '3001' });
    expect(source).toMatchObject({ kind: 'own-time-answer', who: 'cleo-example', where: 'GitHub comment 3001 on ticket #3' });
  });
});

describe('the fixtures of own-time chats and comment pickups', () => {
  it('follow the store layout at every step', () => {
    for (const name of FIXTURE_NAMES) {
      expect(() => checkProjectFixture(fixtures[name]), name).not.toThrow();
    }
  });

  it('show done with questions open releasing the ticket, unlocked, with its open question visible', () => {
    const outcome = answerRun(fixtures.before, fixtures['after-own-time-release'], { mode: 'own-time', ticket: 2 });
    const ticket = checkProjectFixture(fixtures['after-own-time-release']).tickets.find((candidate) => candidate.number === 2);

    expect(outcome).toEqual({ problems: [], closed: [], prdDue: false });
    expect([ticket?.state, ticket?.assignee]).toEqual(['open', null]);
    expect(ticket?.comments.map((comment) => comment.kind)).toEqual(['answer', 'discussion']);
  });

  it('show done with every question answered closing the ticket with a decision, the map not done yet', () => {
    const outcome = answerRun(fixtures['after-own-time-release'], fixtures['after-own-time-close'], { mode: 'own-time', ticket: 2 });
    const after = checkProjectFixture(fixtures['after-own-time-close']);

    expect(outcome).toEqual({ problems: [], closed: [2], prdDue: false });
    expect(after.map.settled.map((line) => line.ticket)).toEqual([2]);
  });

  it('show a pickup turning comments into answers via GitHub, recorded by the runner, closing the ticket another member holds', () => {
    const outcome = answerRun(fixtures['after-own-time-close'], fixtures['after-pickup'], { mode: 'pickup' });
    const after = checkProjectFixture(fixtures['after-pickup']);
    const held = after.tickets.find((ticket) => ticket.number === 3);
    const waiting = after.tickets.find((ticket) => ticket.number === 4)?.comments.find((comment) => comment.id === '4002');

    expect(outcome).toEqual({ problems: [], closed: [3], prdDue: false });
    expect([held?.state, held?.assignee]).toEqual(['closed', 'cleo-example']);
    expect(waiting?.kind).toBe('plain');
  });

  it('show the pickup that closes the last open ticket leaving the map done, so the map-done rule starts /grillo-prd', () => {
    const outcome = answerRun(fixtures['after-pickup'], fixtures['after-last-pickup'], { mode: 'pickup' });

    expect(outcome).toEqual({ problems: [], closed: [4], prdDue: true });
  });

  it.each<[string, FixtureName, FixtureName, Run, (files: Record<string, string>) => Record<string, string>, string]>([
    [
      'keeps the ticket held after done with questions open',
      'before',
      'after-own-time-release',
      { mode: 'own-time', ticket: 2 },
      (files) => edited(files, MANIFEST, '"state": "open",\n      "assignee": null', '"state": "open",\n      "assignee": "ada-example"'),
      'held by ada-example',
    ],
    [
      'renames a question',
      'after-own-time-release',
      'after-own-time-close',
      { mode: 'own-time', ticket: 2 },
      (files) => edited(files, 'issues/2.md', 'How long is one repair slot?', 'How long is a slot?'),
      'Q2.2',
    ],
    [
      'drops the member\'s words from the chat discussion',
      'before',
      'after-own-time-release',
      { mode: 'own-time', ticket: 2 },
      (files) => edited(files, 'comments/2002.md', 'most riders only come twice a year', 'riders rarely come'),
      'word for word',
    ],
    [
      'unassigns the member who holds a ticket',
      'after-own-time-close',
      'after-pickup',
      { mode: 'pickup' },
      (files) => edited(files, MANIFEST, '"assignee": "cleo-example"', '"assignee": null'),
      'changed who holds ticket #3',
    ],
    [
      'credits the source to the member who recorded it',
      'after-own-time-close',
      'after-pickup',
      { mode: 'pickup' },
      (files) => edited(files, '.grillo/sources/S4.md', 'who: cleo-example', 'who: ada-example'),
      'by its author',
    ],
    [
      'summarises the comment into its source',
      'after-own-time-close',
      'after-pickup',
      { mode: 'pickup' },
      (files) => edited(files, '.grillo/sources/S4.md', 'Only the rider who booked, or a volunteer on shift. Nobody else.', 'The rider or a volunteer.'),
      'word for word',
    ],
    [
      'edits a waiting comment',
      'after-own-time-close',
      'after-pickup',
      { mode: 'pickup' },
      (files) => edited(files, 'comments/4002.md', 'next Saturday', 'on Saturday'),
      'comments/4002.md',
    ],
    [
      'leaves a fully answered ticket open',
      'after-pickup',
      'after-last-pickup',
      { mode: 'pickup' },
      (files) =>
        edited(
          edited(files, MANIFEST, '"state": "closed",\n      "assignee": null', '"state": "open",\n      "assignee": null'),
          'issues/1.md',
          '- #4 About 6 riders turned away each Saturday, 40-minute waits\n',
          '',
        ),
      'left ticket #4 open',
    ],
  ])('would flag a run that %s', (_what, from, to, run, change, mentions) => {
    const { problems } = answerRun(fixtures[from], change(fixtures[to]), run);

    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining(mentions)]));
  });
});
