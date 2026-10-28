import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkProjectFixture, readFixtureFolder } from '../fixture-check';
import { itChecksTheKindAgentSkill } from '../kind-agent-skill';
import { checkKindRun } from '../kind-run';

/**
 * The research agent's skill, checked without the model: the shared checks of a kind agent's skill file, and fixtures
 * of one project before and after a research run against the store layout and the rules of a research run. Live
 * behaviour with the model is the demo's job.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const RUN = { kind: 'research', ticket: 2, runner: 'ada-example' } as const;

const before = await readFixtureFolder(join(FIXTURES, 'before'));
const after = await readFixtureFolder(join(FIXTURES, 'after-research'));

describe('the grillo-research skill', () => {
  itChecksTheKindAgentSkill('research', ['A document or a research finding', 'The member, in a chat']);
});

describe('the fixtures of a research run', () => {
  it('follow the store layout before and after the run', () => {
    expect(() => checkProjectFixture(before)).not.toThrow();
    expect(() => checkProjectFixture(after)).not.toThrow();
  });

  it('show every question answered from a linked document, the ticket closed with its decision and the map not done yet', () => {
    const outcome = checkKindRun(before, after, RUN);
    const fixture = checkProjectFixture(after);
    const ticket = fixture.tickets.find((candidate) => candidate.number === RUN.ticket);
    const cited = new Set(ticket?.comments.flatMap((comment) => (comment.kind === 'answer' ? comment.sources : [])));

    expect(outcome).toEqual({ problems: [], closed: [2], prdDue: false });
    expect(ticket?.comments.map((comment) => comment.kind)).toEqual(['answer', 'answer', 'decision']);
    expect(fixture.sources.filter((source) => cited.has(source.code)).map((source) => source.kind)).toEqual(['document', 'document']);
    expect(fixture.map.settled.map((line) => line.ticket)).toEqual([2]);
  });
});
