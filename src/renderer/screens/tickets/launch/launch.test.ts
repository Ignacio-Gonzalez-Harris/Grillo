import { describe, expect, it } from 'vitest';
import { readCommandCatalogue } from '../../../../../resources/skills/catalogue';
import type { Member, Ticket } from '../../../../main/store/types';
import type { AgentInfo } from '../../../../shared/agents';
import { launchFor, launchState } from './launch';

// Made-up members, tickets and agents only.
const ME: Member = { login: 'ada-example', name: null, email: null, role: 'developer', domains: ['developer'] };

function ticket(extra: Partial<Ticket> = {}): Ticket {
  return {
    id: { project: 'example-org/sample-project-1', number: 5 },
    title: 'Sample ticket 5',
    question: 'A made-up question?',
    whyItMatters: 'A made-up reason.',
    assumptions: [],
    kind: 'research',
    state: 'open',
    assignee: null,
    domains: [],
    noDomain: true,
    blockers: [],
    duplicateOf: null,
    questions: [],
    ...extra,
  };
}

function agent(extra: Partial<AgentInfo> = {}): AgentInfo {
  return { id: 'agent-1', kind: 'research', title: 'Research · Sample ticket 5', folder: '/memory/sample', waiting: false, ...extra };
}

describe('launchFor: which ticket kinds get a launch control', () => {
  it.each([
    ['research', 'Launch research agent', '/grillo-research 12', 'Research · Sample ticket 12', 'finding'],
    ['prototype', 'Launch prototype agent', '/grillo-prototype 12', 'Prototype · Sample ticket 12', 'outcome'],
    ['task', 'Launch task agent', '/grillo-task 12', 'Task · Sample ticket 12', 'outcome'],
  ])('a %s ticket gets "%s", which types %s into a tab named %s', (kind, label, command, title, records) => {
    const launch = launchFor(kind);
    expect(launch).not.toBeNull();
    expect(launch?.kind).toBe(kind);
    expect(launch?.label).toBe(label);
    expect(launch?.command(12)).toBe(command);
    expect(launch?.title('Sample ticket 12')).toBe(title);
    expect(launch?.records).toBe(records);
  });

  it.each(['grilling', 'support', 'generic', 'Research', ' research', '', 'meeting', 'unknown-kind', 'constructor', 'toString'])(
    'a ticket of kind "%s" gets no launch control',
    (kind) => {
      expect(launchFor(kind)).toBeNull();
    },
  );

  it('every launch command is the catalogue command of that kind, release 3, with the ticket number filled in', async () => {
    const catalogue = await readCommandCatalogue();
    for (const kind of ['research', 'prototype', 'task']) {
      const entry = catalogue.find((command) => command.name === `grillo-${kind}`);
      expect(entry, `catalogue entry for ${kind}`).toBeDefined();
      expect(entry?.kind).toBe(kind);
      expect(entry?.release).toBe(3);
      expect(launchFor(kind)?.command(7)).toBe(entry?.command.replace('<ticket number>', '7'));
    }
  });
});

describe('launchState: whether the control may launch now', () => {
  it('a research, prototype or task ticket nobody holds and no tab runs can launch', () => {
    for (const kind of ['research', 'prototype', 'task'] as const) {
      expect(launchState(ticket({ kind }), ME, []).name).toBe('ready');
    }
  });

  it('a grilling ticket, a closed ticket or a ticket of an unknown kind has no control at all', () => {
    expect(launchState(ticket({ kind: 'grilling' }), ME, []).name).toBe('none');
    expect(launchState(ticket({ state: 'closed' }), ME, []).name).toBe('none');
    expect(launchState(ticket({ kind: 'unknown-kind' as Ticket['kind'] }), ME, []).name).toBe('none');
  });

  it('a ticket held by a member, me included, cannot be launched, and says who holds it', () => {
    expect(launchState(ticket({ assignee: 'ben-example' }), ME, [])).toMatchObject({ name: 'held', reason: 'Assigned to ben-example. A ticket already held by an agent or a member cannot be launched again.' });
    expect(launchState(ticket({ assignee: 'ADA-example' }), ME, [])).toMatchObject({ name: 'held', reason: 'Assigned to you. A ticket already held by an agent or a member cannot be launched again.' });
  });

  it('a ticket whose agent tab still runs cannot be launched again, and names the tab', () => {
    expect(launchState(ticket(), ME, [agent()])).toMatchObject({ name: 'held', reason: 'Running in the Research · Sample ticket 5 tab.' });
  });

  it('a tab of another kind or for another ticket does not hold it', () => {
    const others = [agent({ kind: 'grilling', title: 'Research · Sample ticket 5' }), agent({ title: 'Research · Sample ticket 6' })];
    expect(launchState(ticket(), ME, others).name).toBe('ready');
  });
});
