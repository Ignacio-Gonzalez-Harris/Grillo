import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readFixtureFolder } from './fixture-check';
import { checkKindRun, type KindRun } from './kind-run';

/**
 * The run check every kind agent's test uses, over the fixtures of the three kind agents: each test changes one
 * fixture the way a run that breaks one rule would leave the project, and expects the check to name that rule.
 */

const SKILLS_ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = 'issues.json';
const fixture = (skill: string, name: string): Promise<Record<string, string>> => readFixtureFolder(join(SKILLS_ROOT, skill, 'fixtures', name));
const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');

const research = { before: await fixture('grillo-research', 'before'), after: await fixture('grillo-research', 'after-research') };
const prototype = { before: await fixture('grillo-prototype', 'before'), after: await fixture('grillo-prototype', 'after-prototype') };
const task = {
  before: await fixture('grillo-task', 'before'),
  release: await fixture('grillo-task', 'after-task-release'),
  close: await fixture('grillo-task', 'after-task-close'),
};
const RESEARCH_RUN: KindRun = { kind: 'research', ticket: 2, runner: 'ada-example' };
const PROTOTYPE_RUN: KindRun = { kind: 'prototype', ticket: 2, runner: 'ada-example' };
const TASK_RUN: KindRun = { kind: 'task', ticket: 2, runner: 'ben-example' };

/** A fixture with one file's text changed. */
function edited(files: Record<string, string>, path: string, from: string, to: string): Record<string, string> {
  const text = unixLines(files[path] ?? '');
  if (!text.includes(from)) {
    throw new Error(`test setup: ${path} does not hold '${from}'`);
  }
  return { ...files, [path]: text.replace(from, to) };
}

/** A fixture with one comment taken off its ticket, as if the run had never posted it. */
function withoutComment(files: Record<string, string>, id: string): Record<string, string> {
  const manifest = JSON.parse(files[MANIFEST]) as { tickets: { comments: { id: string; body: string }[] }[] };
  const body = manifest.tickets.flatMap((ticket) => ticket.comments).find((comment) => comment.id === id)?.body ?? '';
  for (const ticket of manifest.tickets) {
    ticket.comments = ticket.comments.filter((comment) => comment.id !== id);
  }
  return Object.fromEntries(Object.entries({ ...files, [MANIFEST]: JSON.stringify(manifest) }).filter(([path]) => path !== body));
}

/** A fixture with one more open grilling ticket hung under the map, as a run's Drift or Done step opens one. */
function withNewTicket(files: Record<string, string>, why: string): Record<string, string> {
  const manifest = JSON.parse(files[MANIFEST]) as { tickets: unknown[] };
  manifest.tickets.push({ number: 4, title: 'How a group pays for a room', labels: ['wayfinder:grilling'], state: 'open', assignee: null, parent: 1, blockedBy: [], body: 'issues/4.md', comments: [] });
  const body = ['### Question', 'How does a group pay for a room?', '', '### Why it matters', why, '', '### Assumptions', '', '### Questions', '- Q4.1 How does a group pay for a room?', '', '### Blocked by', ''].join('\n');
  return { ...files, [MANIFEST]: JSON.stringify(manifest), 'issues/4.md': body };
}

describe('the kind agent run check', () => {
  it('accepts a run that opens a new ticket, as its Drift and Done steps may, and checks its body for machine paths', () => {
    const opened = withNewTicket(research.after, 'Flows: writing bookings needs the paid plan the research found.');
    const leaked = withNewTicket(research.after, 'Flows: the price list in C:\\Users\\ada-example\\prices.txt decides it.');

    expect(checkKindRun(research.before, opened, RESEARCH_RUN).problems).toEqual([]);
    expect(checkKindRun(research.before, leaked, RESEARCH_RUN).problems).toEqual(['the run wrote an absolute machine path into issues/4.md']);
  });

  it('passes each kind agent run its fixtures show', () => {
    expect(checkKindRun(research.before, research.after, RESEARCH_RUN).problems).toEqual([]);
    expect(checkKindRun(prototype.before, prototype.after, PROTOTYPE_RUN).problems).toEqual([]);
    expect(checkKindRun(task.before, task.release, TASK_RUN).problems).toEqual([]);
    expect(checkKindRun(task.release, task.close, TASK_RUN).problems).toEqual([]);
  });

  it('accepts an answer resting on a transcript chunk a screen handed over with use it', () => {
    const chunk = edited(research.after, '.grillo/sources/S2.md', 'kind: document', 'kind: pasted-text');

    expect(checkKindRun(research.before, chunk, RESEARCH_RUN).problems).toEqual([]);
  });

  it.each<[string, Record<string, string>, Record<string, string>, KindRun, string]>([
    ['works a ticket of another kind', prototype.before, prototype.after, RESEARCH_RUN, 'a prototype ticket'],
    ['records as a member other than the one running it', research.before, research.after, { ...RESEARCH_RUN, runner: 'ben-example' }, 'not by the member running the agent'],
    [
      'marks its answer as recorded by another agent',
      research.before,
      edited(research.after, 'comments/2001.md', 'via:\n', 'via: generic-agent\n'),
      RESEARCH_RUN,
      'marked as turned from GitHub or another agent',
    ],
    [
      'rests a research finding on a document with no link',
      research.before,
      edited(research.after, '.grillo/sources/S2.md', ', https://calendar.example.com/docs/shared-calendars', ''),
      RESEARCH_RUN,
      'answer 2001 on ticket #2 rests on S2',
    ],
    [
      'rests a prototype answer on a document instead of the runner\'s reaction',
      prototype.before,
      edited(prototype.after, '.grillo/sources/S2.md', 'kind: own-time-answer', 'kind: document'),
      PROTOTYPE_RUN,
      'answer 2001 on ticket #2 rests on S2',
    ],
    [
      'rests a task fact on a document that is no work record of the task agent',
      task.release,
      edited(task.close, '.grillo/sources/S4.md', 'where: Grillo, task agent on ticket #2', 'where: the sign-up sheet export'),
      TASK_RUN,
      'answer 2003 on ticket #2 rests on S4',
    ],
    ['records a prototype answer with no discussion of the prototype', prototype.before, withoutComment(prototype.after, '2002'), PROTOTYPE_RUN, 'answer 2001 on ticket #2 has no discussion'],
    [
      'drops the runner\'s words from a discussion',
      task.before,
      edited(task.release, 'comments/2002.md', 'I only see the current week', 'I see one week'),
      TASK_RUN,
      'word for word',
    ],
    [
      'keeps the ticket held after done with questions open',
      task.before,
      edited(task.release, MANIFEST, '"state": "open",\n      "assignee": null', '"state": "open",\n      "assignee": "ben-example"'),
      TASK_RUN,
      'held by ben-example',
    ],
    [
      'leaves a fully answered ticket open',
      research.before,
      edited(
        edited(research.after, MANIFEST, '"state": "closed"', '"state": "open"'),
        'issues/1.md',
        '- #2 Read bookings from the shared calendar, up to 600 requests an hour\n',
        '',
      ),
      RESEARCH_RUN,
      'left ticket #2 open with every question answered',
    ],
    [
      'writes on a ticket it was not started on',
      research.before,
      edited(research.after, MANIFEST, '"assignee": "cleo-example"', '"assignee": "ada-example"'),
      RESEARCH_RUN,
      'ticket #3, which it was not started on',
    ],
    ['writes a prototype into the project folder', prototype.before, { ...prototype.after, 'prototype/rota.html': '<p>made-up rota</p>' }, PROTOTYPE_RUN, 'prototype/rota.html'],
    [
      'edits a comment an earlier run posted',
      task.release,
      edited(task.close, 'comments/2001.md', 'five columns', 'six columns'),
      TASK_RUN,
      'edited or deleted comment 2001',
    ],
  ])('flags a run that %s', (_what, before, after, run, mentions) => {
    expect(checkKindRun(before, after, run).problems).toEqual(expect.arrayContaining([expect.stringContaining(mentions)]));
  });

  it.each(['C:\\Users\\ben-example\\signups.csv', 'C:/Users/ben-example/signups.csv', '/Users/ben-example/signups.csv', '/home/ben-example/signups.csv', '(/tmp/tmp.x1/signups.csv)'])(
    'flags a work record that names the machine path %s',
    (path) => {
      const after = edited(task.close, '.grillo/sources/S4.md', 'signups-september.csv', path);

      expect(checkKindRun(task.release, after, TASK_RUN).problems).toEqual(['the run wrote an absolute machine path into .grillo/sources/S4.md']);
    },
  );
});
