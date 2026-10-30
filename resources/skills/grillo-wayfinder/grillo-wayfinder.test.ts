import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { formatMapBody, formatTicketBody, parseComment, parseMapBody, parseTicketBody } from '../../../src/main/store/github/issues/bodies';
import { parseSource } from '../../../src/main/store/github/repo/records';
import { MEETING_HOLDS_FOLDER, releaseHoldsOf } from '../../../src/main/features/session/holds';
import { AGENT_ID_VARIABLE } from '../../../src/shared/agents';
import { readCommandCatalogue } from '../catalogue';
import { checkProjectFixture, readFixtureFolder } from '../fixture-check';

/**
 * The grilling engine's skill files, checked without the model: the SKILL.md frontmatter and command against the
 * catalogue, every record format the skill teaches against the store's own parsers and `docs/store-layout.md`, and
 * the fixture of a session's output against the store layout. Live behaviour with the model is the demo's job.
 */

const SKILL_FOLDER = dirname(fileURLToPath(import.meta.url));
const SKILL_NAME = 'grillo-wayfinder';
const SKILLS_ROOT = join(SKILL_FOLDER, '..');
const REPOSITORY_ROOT = join(SKILLS_ROOT, '..', '..');
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

/** The contents of every fenced code block, a block indented under a list item taken out of its indent. */
function codeBlocksOf(markdown: string): string[] {
  return [...markdown.matchAll(/^( *)```[a-z]*\n([\s\S]*?)^\1```$/gm)].map(([, indent, body]) =>
    body
      .split('\n')
      .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
      .join('\n'),
  );
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

/** One `## ` section of a Markdown file, up to the next one, found by its heading's name (any ` (...)` note left off). */
function sectionOf(markdown: string, heading: string): string {
  const start = markdown.search(new RegExp(`\\n## ${heading}(?: \\(.*\\))?\\n`));
  return start === -1 ? '' : markdown.slice(start + 1).split(/\n## /)[0];
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

describe('starting the PRD writer once the map is done', () => {
  const oneLine = (text: string): string => text.replace(/\s+/g, ' ');

  /** The skills that tell the agent closing the last ticket to start the PRD writer itself, in the same agent. */
  async function skillsStartingThePrdWriter(): Promise<string[]> {
    const folders = readdirSync(SKILLS_ROOT, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && existsSync(join(SKILLS_ROOT, entry.name, 'SKILL.md')),
    );
    const texts = await Promise.all(
      folders.map(async ({ name }) => [name, oneLine(await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8'))] as const),
    );
    return texts.filter(([, text]) => /run `\/grillo-prd` in (?:this|the) same agent/.test(text)).map(([name]) => name);
  }

  it("lets the agent that closes the last ticket start /grillo-prd itself: the rule and the PRD writer's flag agree", async () => {
    const rule = oneLine(sectionOf(await read('SKILL.md'), 'The map-done rule'));
    const prd = frontmatterOf((await readFile(join(SKILLS_ROOT, 'grillo-prd', 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n'));
    const starters = await skillsStartingThePrdWriter();

    expect(rule).toContain('run `/grillo-prd` in this same agent');
    expect(starters).toEqual(expect.arrayContaining([SKILL_NAME, 'grillo-answer', 'grillo-research', 'grillo-prototype', 'grillo-task']));
    // `disable-model-invocation: true` would make the Skill tool refuse every agent that follows the rule.
    expect(prd['disable-model-invocation'] ?? false).toBe(false);
    expect(prd['user-invocable'] ?? true).toBe(true);
  });
});

/** Where Git for Windows puts its bash by default. */
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

/** Bash as the agents run it: Git for Windows' own on Windows, found beside git when it is not in its default place. */
function findBash(): string {
  if (process.platform !== 'win32') return 'bash';
  if (existsSync(GIT_BASH)) return GIT_BASH;
  const bundled = join(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(), '..', '..', '..', 'bin', 'bash.exe');
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

describe('holding a ticket on this laptop, outside a live session', () => {
  // Every grilling agent on one laptop acts for the same login, so to GitHub they are one member.
  const HOLDING = 'Holding a ticket on this laptop';
  const OUTSIDE_A_SESSION = `${MEETING_HOLDS_FOLDER.replaceAll('\\', '/')}/no-session/`;
  const fill = (command: string, ticket: number) => command.replaceAll('<ticket number>', String(ticket));
  const asTab = (tab: string, command: string) => `export ${AGENT_ID_VARIABLE}=${tab}; ${command}`;

  async function holdCommands(): Promise<{ hold: string; release: string }> {
    const blocks = codeBlocksOf(sectionOf(await read('SKILL.md'), HOLDING)).map((block) => block.trim());
    expect(blocks).toHaveLength(2);
    const [hold, release] = blocks;
    return { hold, release };
  }

  async function inEmptyProject(run: (project: string) => Promise<void>): Promise<void> {
    // A project folder as the commands see it: only its .git folder matters to them.
    const project = mkdtempSync(join(tmpdir(), 'grillo-laptop-hold-'));
    mkdirSync(join(project, '.git'));
    try {
      await run(project);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }

  it('keeps its holds inside .git, beside the holds of a live session, so they are never committed', async () => {
    const { hold, release } = await holdCommands();
    const paths = fill(`${hold} ${release}`, 3)
      .split(/[\s"'>]+/)
      .filter((word) => word.includes('meeting-holds'));

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((path) => !path.startsWith(OUTSIDE_A_SESSION) && `${path}/` !== OUTSIDE_A_SESSION)).toEqual([]);
  });

  it('lets only one of two grilling agents under one login take the same frontier ticket, until it lets go', async () => {
    const { hold, release } = await holdCommands();
    await inEmptyProject(async (project) => {
      const outcome = (commands: string) => `{ ${commands}; } 2>/dev/null && echo free || echo held`;
      // Two agents hold the first frontier ticket at the same moment; the loser's next ticket is free, and once the
      // winner lets go the first ticket can be held again.
      const script = [
        `(${asTab('tab-1', fill(hold, 3))}) 2>/dev/null & first=$!`,
        `(${asTab('tab-2', fill(hold, 3))}) 2>/dev/null & second=$!`,
        'wait $first && echo held-by-me || echo refused',
        'wait $second && echo held-by-me || echo refused',
        outcome(asTab('tab-2', fill(hold, 8))),
        outcome(`${fill(release, 3)} && ${asTab('tab-2', fill(hold, 3))}`),
      ].join('\n');

      const [first, second, next, afterLettingGo] = await runInProject(script, project);

      expect([first, second].sort()).toEqual(['held-by-me', 'refused']);
      expect([next, afterLettingGo]).toEqual(['free', 'free']);
    });
  });

  it('names the tab that holds it, so Grillo lets go of the hold once that tab stops', async () => {
    const { hold } = await holdCommands();
    await inEmptyProject(async (project) => {
      await runInProject([asTab('tab-1', fill(hold, 3)), asTab('tab-2', fill(hold, 8))].join('\n'), project);

      expect(releaseHoldsOf(project, 'tab-1')).toEqual([{ session: 'no-session', ticket: 3 }]);
      expect(await runInProject(`{ ${asTab('tab-3', fill(hold, 3))}; } && echo free`, project)).toEqual(['free']);
    });
  });

  it('holds before every claim, so a ticket assigned to the member is never taken as won without it, and lets go on leaving', async () => {
    const skill = await read('SKILL.md');
    const link = '(#holding-a-ticket-on-this-laptop)';
    const claiming = sectionOf(skill, 'Claiming a ticket');
    const working = sectionOf(skill, 'Working a ticket');
    const holdStep = claiming.indexOf(link);

    expect(holdStep).toBeGreaterThan(-1);
    expect(holdStep).toBeLessThan(claiming.indexOf('Already assigned to the member'));
    expect(holdStep).toBeLessThan(claiming.indexOf('--add-assignee @me'));
    expect(/^7\. [\s\S]*/m.exec(working)?.[0]).toContain(link);
  });
});
