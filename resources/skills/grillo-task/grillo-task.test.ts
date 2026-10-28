import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkProjectFixture, readFixtureFolder } from '../fixture-check';
import { itChecksTheKindAgentSkill } from '../kind-agent-skill';
import { checkKindRun } from '../kind-run';

/**
 * The task agent's skill, checked without the model: the shared checks of a kind agent's skill file, the work record
 * it teaches, and fixtures of one project through two task runs (one waiting on the member, one finishing the work)
 * against the store layout and the rules of a task run. Live behaviour with the model is the demo's job.
 */

const SKILL_FOLDER = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(SKILL_FOLDER, 'fixtures');
const RUN = { kind: 'task', ticket: 2, runner: 'ben-example' } as const;
const WORK_RECORD_WHERE = '`Grillo, task agent on ticket #<N>`';

const [before, afterRelease, afterClose] = await Promise.all(['before', 'after-task-release', 'after-task-close'].map((name) => readFixtureFolder(join(FIXTURES, name))));

describe('the grillo-task skill', () => {
  itChecksTheKindAgentSkill('task', ['The member, in a chat']);

  it('teaches the work record of what the agent did alone, as a document source of its own', async () => {
    const skill = (await readFile(join(SKILL_FOLDER, 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');

    expect(skill).toContain('`kind: document`');
    expect(skill).toContain(WORK_RECORD_WHERE);
  });
});

describe('the fixtures of two task runs', () => {
  it('follow the store layout at every step', () => {
    for (const files of [before, afterRelease, afterClose]) {
      expect(() => checkProjectFixture(files)).not.toThrow();
    }
  });

  it('show done with the work still waiting on someone releasing the ticket, unlocked, its open question visible', () => {
    const outcome = checkKindRun(before, afterRelease, RUN);
    const ticket = checkProjectFixture(afterRelease).tickets.find((candidate) => candidate.number === RUN.ticket);

    expect(outcome).toEqual({ problems: [], closed: [], prdDue: false });
    expect([ticket?.state, ticket?.assignee]).toEqual(['open', null]);
  });

  it('show the run that finishes the work closing the last open ticket, so the map-done rule starts /grillo-prd', () => {
    const outcome = checkKindRun(afterRelease, afterClose, RUN);
    const fixture = checkProjectFixture(afterClose);
    const ticket = fixture.tickets.find((candidate) => candidate.number === RUN.ticket);
    const answer = ticket?.comments.filter((comment) => comment.kind === 'answer').at(-1);

    expect(outcome).toEqual({ problems: [], closed: [2], prdDue: true });
    expect(fixture.sources.find((source) => answer?.sources.includes(source.code))).toMatchObject({ kind: 'document', where: 'Grillo, task agent on ticket #2' });
  });
});
