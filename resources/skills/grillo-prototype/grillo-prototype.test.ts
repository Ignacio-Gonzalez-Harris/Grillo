import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkProjectFixture, readFixtureFolder } from '../fixture-check';
import { itChecksTheKindAgentSkill } from '../kind-agent-skill';
import { checkKindRun } from '../kind-run';

/**
 * The prototype agent's skill, checked without the model: the shared checks of a kind agent's skill file, and
 * fixtures of one project before and after a prototype run against the store layout and the rules of a prototype
 * run. Live behaviour with the model is the demo's job.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const RUN = { kind: 'prototype', ticket: 2, runner: 'ada-example' } as const;

const before = await readFixtureFolder(join(FIXTURES, 'before'));
const after = await readFixtureFolder(join(FIXTURES, 'after-prototype'));

describe('the grillo-prototype skill', () => {
  itChecksTheKindAgentSkill('prototype', ['The member, in a chat']);
});

describe('the fixtures of a prototype run', () => {
  it('follow the store layout before and after the run', () => {
    expect(() => checkProjectFixture(before)).not.toThrow();
    expect(() => checkProjectFixture(after)).not.toThrow();
  });

  it('show each reaction to the prototype recorded as an answer with its exchange, the ticket closed with its decision', () => {
    const outcome = checkKindRun(before, after, RUN);
    const ticket = checkProjectFixture(after).tickets.find((candidate) => candidate.number === RUN.ticket);

    expect(outcome).toEqual({ problems: [], closed: [2], prdDue: false });
    expect(ticket?.comments.map((comment) => comment.kind)).toEqual(['answer', 'discussion', 'answer', 'discussion', 'decision']);
  });
});
