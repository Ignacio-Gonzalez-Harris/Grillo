import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { domainOf, isDomainLabel, NO_DOMAIN_LABEL, parseComment } from '../../../src/main/store/github/issues/bodies';
import { parseMembers, parseSession, parseSource } from '../../../src/main/store/github/repo/records';
import { sameLogin } from '../../../src/main/store/github/repo/names';
import { QUESTION_FILE, readTicketHolds } from '../../../src/main/features/session/holds';
import { AGENT_ID_VARIABLE } from '../../../src/shared/agents';
import { readCommandCatalogue } from '../catalogue';
import { checkProjectFixture, type CheckedTicket, readFixtureFolder } from '../fixture-check';

/**
 * The live session's skill file, checked without the model: the SKILL.md frontmatter and command against the
 * catalogue, the protocol messages it follows against the catalogue's protocol table, the records it shows against
 * the store's own parsers, and fixtures of a project before and after a live session against the store layout and
 * the rules of a session. Live behaviour with the model is the demo's job.
 */

const SKILL_FOLDER = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = 'grillo-meeting';
const COMMAND = '/grillo-meeting';
const SKILLS_ROOT = join(SKILL_FOLDER, '..');
const FIXTURES = join(SKILL_FOLDER, 'fixtures');
const MANIFEST = 'issues.json';
const MEMBERS_FILE = '.grillo/members.json';
const SESSION_FILE = /^\.grillo\/sessions\/(\d{4}-\d{2}-\d{2}-\d{6})\.md$/;
const SOURCE_FILE = /^\.grillo\/sources\/S\d+\.md$/;
const ISSUE_BODY = /^issues\/\d+\.md$/;
const COMMENT_FILE = /^comments\/\d+\.md$/;

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

/** The contents of every fenced code block, a block indented under a list item taken out of its indent. */
function codeBlocksOf(markdown: string): string[] {
  return [...markdown.matchAll(/^( *)```[a-z]*\n([\s\S]*?)^\1```$/gm)].map(([, indent, body]) =>
    body
      .split('\n')
      .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
      .join('\n'),
  );
}

/** One `## ` section of a Markdown file, up to the next one. */
function sectionOf(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  return start === -1 ? '' : markdown.slice(start + 1).split(/\n## /)[0];
}

/** The cells of the table rows in a section, the header and divider left out. */
function tableRows(section: string): string[][] {
  return section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => line.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim()));
}

const codeSpans = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

/** The control lines the catalogue's protocol table gives to messages this skill accepts, by name or as every agent. */
async function catalogueControlLines(): Promise<string[]> {
  const readme = unixLines(await readFile(join(SKILLS_ROOT, 'README.md'), 'utf8'));
  const section = sectionOf(readme, 'Screen-to-agent protocol');
  const header = section.split('\n').find((line) => line.startsWith('|')) ?? '';
  const columns = header.slice(1, -1).split('|').map((cell) => cell.trim());
  const controlColumn = columns.indexOf('Exact control line');
  const acceptedColumn = columns.indexOf('Accepted by');
  if (controlColumn === -1 || acceptedColumn === -1) {
    throw new Error('test setup: the protocol table lacks its columns');
  }
  return tableRows(section)
    .filter((row) => row[acceptedColumn].includes(`\`${COMMAND}\``) || row[acceptedColumn] === 'Every agent')
    .flatMap((row) => codeSpans(row[controlColumn]));
}

// The rules of a live session, checked on a project before and after it.

const FIXTURE_NAMES = ['before-session', 'after-session'] as const;
const fixtures: Record<(typeof FIXTURE_NAMES)[number], Record<string, string>> = Object.fromEntries(
  await Promise.all(
    FIXTURE_NAMES.map(async (name) => [name, Object.fromEntries(Object.entries(await readFixtureFolder(join(FIXTURES, name))).map(([path, text]) => [path, unixLines(text)]))] as const),
  ),
) as Record<(typeof FIXTURE_NAMES)[number], Record<string, string>>;

/** The question lines of a ticket body as written: `Q<n>.<k> <text>`. */
const questionLines = (ticket: CheckedTicket): string[] => ticket.body.questions.map((question) => `Q${ticket.number}.${question.k} ${question.text ?? '(removed)'}`);

/**
 * Every way a project after a live session breaks the rules of a session, given the project before it and the tickets
 * the host jumped to. Only additions: earlier comments, sources and question lines stay as they were. Every answer the
 * session recorded cites only meeting sources naming the session file, its present members and a moment after it
 * started; every discussion follows its answer, names the session file and holds the source's talk word for word, as
 * the transcript has it. A ticket worked in the session matches someone present (unless jumped to) and is closed or
 * released; a ticket born from drift has no domain label yet.
 */
function sessionProblems(beforeFiles: Record<string, string>, afterFiles: Record<string, string>, jumpedTo: number[] = []): string[] {
  const problems: string[] = [];
  const before = checkProjectFixture(beforeFiles);
  const after = checkProjectFixture(afterFiles);

  // Files: the session file is new, and nothing earlier changed but the manifest and the issue bodies.
  const sessionPaths = Object.keys(afterFiles).filter((path) => SESSION_FILE.test(path) && !(path in beforeFiles));
  if (sessionPaths.length !== 1) {
    return [`a session adds exactly one session file, found ${sessionPaths.length}`];
  }
  const [sessionPath] = sessionPaths;
  const session = parseSession(afterFiles[sessionPath], SESSION_FILE.exec(sessionPath)?.[1] ?? '', sessionPath);
  for (const path of Object.keys(beforeFiles)) {
    if (!(path in afterFiles)) {
      problems.push(`the session deleted ${path}`);
    } else if (path !== MANIFEST && !ISSUE_BODY.test(path) && beforeFiles[path] !== afterFiles[path]) {
      problems.push(`the session changed ${path}`);
    }
  }
  for (const path of Object.keys(afterFiles).filter((name) => !(name in beforeFiles) && name !== sessionPath)) {
    if (!SOURCE_FILE.test(path) && !ISSUE_BODY.test(path) && !COMMENT_FILE.test(path)) {
      problems.push(`the session wrote ${path}, which a session never writes`);
    }
  }

  const members = parseMembers(afterFiles[MEMBERS_FILE], MEMBERS_FILE);
  const presentDomains = new Set(members.filter((member) => session.present.some((login) => sameLogin(login, member.login))).flatMap((member) => member.domains));
  const isPresent = (login: string): boolean => session.present.some((present) => sameLogin(present, login));
  const sources = new Map(after.sources.map((source) => [source.code, source]));
  const earlierSources = new Set(before.sources.map((source) => source.code));

  for (const ticket of after.tickets) {
    const earlier = before.tickets.find((candidate) => candidate.number === ticket.number);
    const earlierIds = new Set(earlier?.comments.map((comment) => comment.id) ?? []);
    const added = ticket.comments.filter((comment) => !earlierIds.has(comment.id));

    // Earlier records stay: comments keep their order and text, question lines and the question itself are kept.
    if (earlier !== undefined) {
      if (JSON.stringify(ticket.comments.slice(0, earlier.comments.length)) !== JSON.stringify(earlier.comments)) {
        problems.push(`the session changed an earlier comment on ticket #${ticket.number}`);
      }
      if (questionLines(ticket).slice(0, earlier.body.questions.length).join('\n') !== questionLines(earlier).join('\n')) {
        problems.push(`the session changed or removed a question line of ticket #${ticket.number}`);
      }
      if (ticket.body.question !== earlier.body.question || ticket.body.whyItMatters !== earlier.body.whyItMatters) {
        problems.push(`the session rewrote the question of ticket #${ticket.number}`);
      }
    } else if (ticket.labels.some(isDomainLabel)) {
      problems.push(`ticket #${ticket.number}, born from drift, already carries a domain label`);
    }

    const answers = added.filter((comment) => comment.kind === 'answer');
    for (const [index, comment] of added.entries()) {
      if (comment.kind === 'answer') {
        if (!isPresent(comment.who)) {
          problems.push(`answer ${comment.id} was recorded by '${comment.who}', who is not present`);
        }
        for (const code of comment.sources) {
          const source = sources.get(code);
          if (earlierSources.has(code) || source === undefined) {
            problems.push(`answer ${comment.id} cites ${code}, which the session did not write`);
            continue;
          }
          const who = source.who.split(', ');
          if (source.kind !== 'meeting' || source.where !== sessionPath) {
            problems.push(`answer ${comment.id} cites ${code}, which is no meeting source naming ${sessionPath}`);
          }
          if (who.length !== session.present.length || !who.every(isPresent)) {
            problems.push(`source ${code} names [${source.who}] where the members present were [${session.present.join(', ')}]`);
          }
          if (Date.parse(source.when) < Date.parse(session.date)) {
            problems.push(`source ${code} is dated before the session started`);
          }
        }
      }
      if (comment.kind === 'discussion') {
        const answer = added.slice(0, index).findLast((other) => other.kind === 'answer');
        const [source] = comment.sources.map((code) => sources.get(code));
        if (answer === undefined || answer.kind !== 'answer' || answer.question !== comment.question || answer.sources.join() !== comment.sources.join()) {
          problems.push(`discussion ${comment.id} does not follow the answer it belongs to, with its sources`);
        }
        if (comment.session !== sessionPath) {
          problems.push(`discussion ${comment.id} names '${comment.session ?? ''}', not the session file ${sessionPath}`);
        }
        if (source === undefined || comment.transcript.trim() !== source.text.trim()) {
          problems.push(`discussion ${comment.id} does not hold its source's talk word for word`);
        } else if (!session.transcript.includes(source.text.trim())) {
          problems.push(`discussion ${comment.id} holds talk the session transcript does not have`);
        }
      }
    }

    // A ticket the session answered on: picked for someone present (or jumped to), then closed or released.
    if (earlier !== undefined && answers.length > 0) {
      const domains = earlier.labels.filter(isDomainLabel);
      const matches = domains.length === 0 || domains.includes(NO_DOMAIN_LABEL) || domains.some((label) => presentDomains.has(domainOf(label)));
      if (!matches && !jumpedTo.includes(ticket.number)) {
        problems.push(`ticket #${ticket.number} was worked although nobody present declares ${domains.join(', ')}`);
      }
      if (ticket.state === 'open' && ticket.assignee !== null) {
        problems.push(`ticket #${ticket.number} was left with questions open but still assigned to ${ticket.assignee}`);
      }
    }
  }
  return problems;
}

/** A fixture's manifest with one ticket's fields replaced. */
function withTicket(files: Record<string, string>, number: number, change: Record<string, unknown>): Record<string, string> {
  const manifest = JSON.parse(files[MANIFEST]) as { tickets: { number: number }[] };
  const index = manifest.tickets.findIndex((ticket) => ticket.number === number);
  if (index === -1) {
    throw new Error(`test setup: no ticket #${number}`);
  }
  manifest.tickets[index] = { ...manifest.tickets[index], ...change };
  return { ...files, [MANIFEST]: JSON.stringify(manifest) };
}

/** A fixture with one file's text replaced, which must change it. */
function withText(files: Record<string, string>, path: string, from: string, to: string): Record<string, string> {
  if (!files[path]?.includes(from)) {
    throw new Error(`test setup: ${path} does not hold '${from}'`);
  }
  return { ...files, [path]: files[path].replace(from, to) };
}

describe('the grillo-meeting skill', () => {
  it('is named after its folder and answers the command the catalogue gives it', async () => {
    const skill = await read('SKILL.md');
    const frontmatter = frontmatterOf(skill);
    const entries = (await readCommandCatalogue()).filter((entry) => entry.folder === SKILL_NAME);

    expect(SKILL_FOLDER.endsWith(SKILL_NAME)).toBe(true);
    expect(frontmatter.name).toBe(SKILL_NAME);
    expect(entries.map((entry) => [entry.command, entry.kind, entry.release])).toEqual([[COMMAND, 'grilling', 1]]);
    expect(entries[0].argument).toBe('');
    expect(frontmatter['argument-hint']).toBeUndefined();
    expect(frontmatter['disable-model-invocation']).toBe(true);
    expect(typeof frontmatter.description).toBe('string');
    expect(skill).toContain(`\`${COMMAND}\``);
  });

  it('names only commands the catalogue holds', async () => {
    const commands = new Set((await readCommandCatalogue()).map((entry) => entry.name));
    const named = [...(await read('SKILL.md')).matchAll(/\/(grillo-[a-z0-9-]+)/g)].map((match) => match[1]);

    expect(named.filter((name) => !commands.has(name))).toEqual([]);
  });

  it('points only at its own sections and the files Grillo ships, never at repository files a project lacks', async () => {
    const skill = await read('SKILL.md');
    const headings = [...skill.matchAll(/^#{2,3} (.+)$/gm)].map((match) => match[1].toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-'));
    const links = [...skill.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]).filter((target) => !/^[a-z]+:/.test(target));

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const [path, anchor] = link.split('#');
      if (path === '') {
        expect(headings, link).toContain(anchor);
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

  it('follows only grillo-wayfinder sections that exist, by their heading', async () => {
    const wayfinder = unixLines(await readFile(join(SKILLS_ROOT, 'grillo-wayfinder', 'SKILL.md'), 'utf8'));
    // A heading's name is its text before any ` (...)` note: `Working a ticket (the engine ...)` is `Working a ticket`.
    const headings = new Set([...wayfinder.matchAll(/^## (.+?)(?: \(.*\))?$/gm)].map((match) => match[1]));
    const named = [...(await read('SKILL.md')).matchAll(/`grillo-wayfinder`, "([^"]+)"(?: and "([^"]+)")?/g)].flatMap((match) =>
      match.slice(1).filter((name) => name !== undefined).map((name) => name.replace(/\s+/g, ' ')),
    );

    expect(named).toEqual(expect.arrayContaining(['Claiming a ticket', 'Working a ticket', 'The map-done rule']));
    expect(named.filter((name) => !headings.has(name))).toEqual([]);
  });

  it('follows exactly the protocol messages the catalogue gives it, one row each, and no others', async () => {
    const expected = await catalogueControlLines();
    const rows = tableRows(sectionOf(await read('SKILL.md'), 'Messages from the meeting screen'));

    expect(expected).toEqual(['present: <logins>', 'session: <path to session file>', 'mode: listen', 'mode: type', 'use it', 'skip', 'jump <ticket number>', 'done']);
    expect(rows.map((row) => codeSpans(row[0]))).toEqual(expected.map((line) => [line]));
  });

  it('teaches the four ticket kind labels and the no-domain tag it picks tickets by', async () => {
    const skill = await read('SKILL.md');

    for (const label of ['wayfinder:grilling', 'wayfinder:research', 'wayfinder:prototype', 'wayfinder:task', 'domain:<name>', NO_DOMAIN_LABEL]) {
      expect(skill, label).toContain(`\`${label}\``);
    }
  });

  it('shows a meeting source and a discussion naming one session, in shapes the store reads back, with the same talk', async () => {
    const blocks = codeBlocksOf(await read('SKILL.md'));
    const [sourceBlock] = blocks.filter((block) => block.startsWith('kind: '));
    const [discussionBlock] = blocks.filter((block) => block.startsWith('<!-- grillo:'));
    const source = parseSource(sourceBlock, 'S6', 'the source example');
    const discussion = parseComment({ id: '1', author: 'ada-example', createdAt: '2026-10-26T14:12:30.000Z', body: discussionBlock });

    expect(blocks.filter((block) => block.startsWith('kind: ') || block.startsWith('<!-- grillo:'))).toHaveLength(2);
    expect(source.kind).toBe('meeting');
    expect(source.where).toMatch(SESSION_FILE);
    expect(source.who.split(', ').length).toBeGreaterThan(1);
    expect(discussion.kind).toBe('discussion');
    expect(discussion.kind === 'discussion' && [discussion.session, discussion.sources, discussion.transcript.trim()]).toEqual([source.where, ['S6'], source.text.trim()]);
  });
});

describe('the fixtures of a live session', () => {
  it('follow the store layout before and after the session', () => {
    for (const name of FIXTURE_NAMES) {
      expect(() => checkProjectFixture(fixtures[name]), name).not.toThrow();
    }
  });

  it('show a session that follows its rules: meeting sources, word-for-word discussions, tickets for those present', () => {
    expect(sessionProblems(fixtures['before-session'], fixtures['after-session'])).toEqual([]);
  });

  it('show an answer typed in Type mode with no discussion, and answers from "use it" each with their discussion', () => {
    const after = checkProjectFixture(fixtures['after-session']);
    const before = checkProjectFixture(fixtures['before-session']);
    const earlierIds = new Set(before.tickets.flatMap((ticket) => ticket.comments.map((comment) => comment.id)));
    const added = after.tickets.flatMap((ticket) => ticket.comments).filter((comment) => !earlierIds.has(comment.id));
    const discussed = new Set(added.flatMap((comment) => (comment.kind === 'discussion' ? [comment.question] : [])));
    const answered = added.flatMap((comment) => (comment.kind === 'answer' ? [comment.question] : []));

    expect(answered.filter((question) => discussed.has(question))).toHaveLength(2);
    expect(answered.filter((question) => !discussed.has(question))).toHaveLength(1);
  });

  it('show drift: a new ticket and a new question with the next code, and a skipped question left open on a released ticket', () => {
    const before = checkProjectFixture(fixtures['before-session']);
    const after = checkProjectFixture(fixtures['after-session']);
    const born = after.tickets.filter((ticket) => !before.tickets.some((earlier) => earlier.number === ticket.number));
    const grown = after.tickets.filter((ticket) => ticket.body.questions.length > (before.tickets.find((earlier) => earlier.number === ticket.number)?.body.questions.length ?? Infinity));
    const answered = (ticket: CheckedTicket) => new Set(ticket.comments.flatMap((comment) => (comment.kind === 'answer' ? [comment.question] : [])));

    expect(born.map((ticket) => [ticket.state, ticket.assignee, ticket.labels])).toEqual([['open', null, ['wayfinder:grilling']]]);
    expect(grown.map((ticket) => ticket.number)).toEqual([6]);
    expect(grown[0].body.questions.map((question) => question.k)).toEqual([1, 2, 3]);
    expect([grown[0].state, grown[0].assignee]).toEqual(['open', null]);
    expect(['Q6.1', 'Q6.2', 'Q6.3'].map((code) => answered(grown[0]).has(code))).toEqual([true, false, false]);
  });

  it('show a ticket closed in the session with its decision on the map, and a ticket of an absent domain left alone', () => {
    const before = checkProjectFixture(fixtures['before-session']);
    const after = checkProjectFixture(fixtures['after-session']);
    const closed = after.tickets.filter((ticket) => ticket.state === 'closed' && before.tickets.find((earlier) => earlier.number === ticket.number)?.state === 'open');
    const absent = after.tickets.find((ticket) => ticket.labels.includes('domain:platform'));

    expect(closed.map((ticket) => ticket.number)).toEqual([3]);
    expect(after.map.settled.map((line) => line.ticket)).toContain(3);
    expect(absent?.comments).toEqual(before.tickets.find((ticket) => ticket.number === absent?.number)?.comments);
    expect(after.mapDone).toBe(false);
  });

  it('would refuse a discussion naming a session file that does not exist', () => {
    const broken = withText(fixtures['after-session'], 'comments/3004.md', 'session: .grillo/sessions/2026-10-26-140000.md', 'session: .grillo/sessions/2026-10-26-150000.md');

    expect(() => sessionProblems(fixtures['before-session'], broken)).toThrow('names the session file .grillo/sessions/2026-10-26-150000.md, which is missing');
  });

  it.each<[string, (files: Record<string, string>) => Record<string, string>, string]>([
    ['cites a pasted-text source for a meeting answer', (files) => withText(files, '.grillo/sources/S6.md', 'kind: meeting', 'kind: pasted-text'), 'no meeting source'],
    ['writes a meeting source without the session file', (files) => withText(files, '.grillo/sources/S7.md', 'where: .grillo/sessions/2026-10-26-140000.md', 'where: the meeting'), 'no meeting source'],
    ['leaves a present member out of a meeting source', (files) => withText(files, '.grillo/sources/S5.md', 'who: ada-example, ben-example', 'who: ada-example'), 'members present'],
    ['names the earlier session in a discussion', (files) => withText(files, 'comments/6002.md', '2026-10-26-140000', '2026-10-24-091500'), 'not the session file'],
    ['tidies the talk in a discussion', (files) => withText(files, 'comments/3004.md', "The member who lent it, I'd say.\n", ''), 'word for word'],
    ['records talk the host left out with skip', (files) => withText(withText(files, '.grillo/sources/S6.md', 'again.', 'again. Let us leave it.'), 'comments/6002.md', 'again.', 'again. Let us leave it.'), 'transcript does not have'],
    ['leaves a ticket assigned after leaving it with questions open', (files) => withTicket(files, 7, { assignee: 'ada-example' }), 'still assigned'],
    ['gives a drift ticket a domain label', (files) => withTicket(files, 8, { labels: ['wayfinder:grilling', 'domain:product'] }), 'born from drift'],
    ['renames a question line', (files) => withText(files, 'issues/6.md', 'Q6.1 How does a member give a tool back?', 'Q6.1 How is a tool returned?'), 'question line'],
    ['changes the members file', (files) => withText(files, MEMBERS_FILE, '"developer"]', '"developer", "garden"]'), 'changed .grillo/members.json'],
  ])('would flag a session that %s', (_what, change, mentions) => {
    const problems = sessionProblems(fixtures['before-session'], change(fixtures['after-session']));

    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining(mentions)]));
  });

  it('would flag a ticket of an absent domain worked without a jump, and accept it after a jump', () => {
    const before = withTicket(fixtures['before-session'], 7, { labels: ['wayfinder:grilling', 'domain:platform'] });
    const after = withTicket(fixtures['after-session'], 7, { labels: ['wayfinder:grilling', 'domain:platform'] });

    expect(sessionProblems(before, after)).toEqual([expect.stringContaining('ticket #7 was worked although nobody present declares domain:platform')]);
    expect(sessionProblems(before, after, [7])).toEqual([]);
  });
});

/** Where Git for Windows puts its bash by default. */
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

/**
 * Bash as the agents run it: Git for Windows' own on Windows (the `bash` on PATH may be another one there), found
 * beside git when it is not in its default place; the system's elsewhere.
 */
function findBash(): string {
  if (process.platform !== 'win32') return 'bash';
  if (existsSync(GIT_BASH)) return GIT_BASH;
  const gitRoot = join(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '..', '..', '..');
  const bundled = join(gitRoot, 'bin', 'bash.exe');
  return existsSync(bundled) ? bundled : 'bash';
}

/** Runs a script in the project folder, as an agent's shell would, and gives back what it printed, one line each. */
function runInProject(script: string, cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(findBash(), ['-c', script], { cwd }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.split('\n').filter((line) => line !== ''));
    });
  });
}

describe('holding a ticket in a live session', () => {
  // Every grilling agent of one session acts for the host's login, so to GitHub they are one member.
  const SESSION = '2026-10-26-140000';
  const EARLIER_SESSION = '2026-10-25-090000';
  const HOLDING = 'Holding a ticket in this session';
  const QUESTION_AT_HAND = 'Telling the screen the question at hand';
  const fill = (command: string, session: string, ticket: number) =>
    command.replaceAll('<session id>', session).replaceAll('<ticket number>', String(ticket));

  async function holdCommands(): Promise<{ hold: string; release: string }> {
    const blocks = codeBlocksOf(sectionOf(await read('SKILL.md'), HOLDING)).map((block) => block.trim());
    const [hold, release] = blocks;
    expect(blocks).toHaveLength(2);
    return { hold, release };
  }

  it('keeps its holds inside .git, so they are never committed', async () => {
    const { hold, release } = await holdCommands();
    const paths = fill(`${hold} ${release}`, SESSION, 3)
      .split(/\s+/)
      .filter((word) => word.includes(SESSION));

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((path) => !path.startsWith('.git/'))).toEqual([]);
  });

  it('lets only one of two grilling agents of a session hold the same ticket, until it lets go', async () => {
    const { hold, release } = await holdCommands();
    // A project folder as the commands see it: only its .git folder matters to them.
    const project = mkdtempSync(join(tmpdir(), 'grillo-hold-'));
    mkdirSync(join(project, '.git'));
    try {
      const outcome = (commands: string) => `{ ${commands}; } 2>/dev/null && echo free || echo held`;
      // Two agents hold the same ticket at the same moment; then another ticket of this session and the same ticket in
      // an earlier session are free, and once the holder lets go the ticket can be held again.
      const script = [
        `(${fill(hold, SESSION, 3)}) 2>/dev/null & first=$!`,
        `(${fill(hold, SESSION, 3)}) 2>/dev/null & second=$!`,
        'wait $first && echo held-by-me || echo refused',
        'wait $second && echo held-by-me || echo refused',
        outcome(`${fill(hold, SESSION, 8)} && ${fill(hold, EARLIER_SESSION, 3)}`),
        outcome(`${fill(release, SESSION, 3)} && ${fill(hold, SESSION, 3)}`),
      ].join('\n');

      const [first, second, others, afterLettingGo] = await runInProject(script, project);

      expect([first, second].sort()).toEqual(['held-by-me', 'refused']);
      expect([others, afterLettingGo]).toEqual(['free', 'free']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('names the tab that holds each ticket, as Grillo reads it to title the tab after its ticket', async () => {
    const { hold, release } = await holdCommands();
    const project = mkdtempSync(join(tmpdir(), 'grillo-hold-'));
    mkdirSync(join(project, '.git'));
    const asTab = (tab: string, command: string) => `export ${AGENT_ID_VARIABLE}=${tab}; ${command}`;
    const held = async () =>
      (await readTicketHolds(project, SESSION)).map(({ ticket, agentId }) => ({ ticket, agentId })).sort((a, b) => a.ticket - b.ticket);
    try {
      await runInProject([asTab('tab-1', fill(hold, SESSION, 3)), asTab('tab-2', fill(hold, SESSION, 8))].join('\n'), project);
      const both = await held();
      await runInProject(fill(release, SESSION, 3), project);

      expect(both).toEqual([
        { ticket: 3, agentId: 'tab-1' },
        { ticket: 8, agentId: 'tab-2' },
      ]);
      expect(await held()).toEqual([{ ticket: 8, agentId: 'tab-2' }]);
      expect(await readTicketHolds(project, EARLIER_SESSION)).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('tells the screen the question at hand with a command Grillo reads back, each time it asks', async () => {
    const { hold } = await holdCommands();
    const section = sectionOf(await read('SKILL.md'), QUESTION_AT_HAND);
    const [tell] = codeBlocksOf(section).map((block) => block.trim());
    const project = mkdtempSync(join(tmpdir(), 'grillo-hold-'));
    mkdirSync(join(project, '.git'));
    try {
      await runInProject(`export ${AGENT_ID_VARIABLE}=tab-1; ${fill(hold, SESSION, 3)}`, project);
      await runInProject(fill(tell, SESSION, 3).replaceAll('<n>', '2').replaceAll('<m>', '3'), project);

      expect((await readTicketHolds(project, SESSION)).map(({ ticket, agentId, question }) => ({ ticket, agentId, question }))).toEqual([
        { ticket: 3, agentId: 'tab-1', question: { at: 2, of: 3 } },
      ]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
    const link = '(#telling-the-screen-the-question-at-hand)';
    expect(sectionOf(await read('SKILL.md'), 'Picking the next ticket')).toContain(link);
    expect(sectionOf(await read('SKILL.md'), 'Recording an answer')).toContain(link);
  });

  it("sends exactly the message the catalogue's agent-to-screen table gives it", async () => {
    const readme = unixLines(await readFile(join(SKILLS_ROOT, 'README.md'), 'utf8'));
    const rows = tableRows(sectionOf(readme, 'Agent-to-screen protocol'));
    const [tell] = codeBlocksOf(sectionOf(await read('SKILL.md'), QUESTION_AT_HAND)).map((block) => block.trim());
    const file = `.git/meeting-holds/<session id>/<ticket number>/${QUESTION_FILE}`;

    expect(rows.map((row) => row[0])).toEqual(['Question at hand']);
    expect(rows[0].join(' ')).toContain(`\`${file}\``);
    expect(rows[0].join(' ')).toContain('`<n> of <m>`');
    expect(tell).toContain(file);
  });

  it('holds before every claim (picking, jumping) and lets go on leaving a ticket', async () => {
    const skill = await read('SKILL.md');
    const link = '(#holding-a-ticket-in-this-session)';
    const jumpRow = tableRows(sectionOf(skill, 'Messages from the meeting screen')).find(([control]) => control === '`jump <ticket number>`');

    expect(sectionOf(skill, 'Picking the next ticket')).toContain(link);
    expect(jumpRow?.[1]).toContain(link);
    expect(sectionOf(skill, 'Leaving a ticket')).toContain(link);
    expect(sectionOf(skill, HOLDING)).toContain('`grillo-wayfinder`, "Claiming a ticket"');
  });
});
