// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Score } from '../../../../main/store/types';
import type { AgentInfo } from '../../../../shared/agents';
import type { GrilloApi } from '../../../../shared/ipc';
import { StoreError } from '../../../../shared/store';
import { checkedScore, scoreBadge, scoreCard, startScore, workingScorers, type ScoreCardOptions } from './score';

// A made-up score of a made-up PRD.
const SCORE: Score = {
  overall: 6.3,
  criteria: [
    { name: 'Clear', mark: 8, comment: 'Sample comment one. Suggestion: define the made-up term.' },
    { name: 'Complete', mark: 6, comment: 'Sample comment two. Suggestion: say how the flow ends.' },
    { name: 'Scope and priorities', mark: 4, comment: 'Sample comment three. Suggestion: say what is out.' },
  ],
  sections: [
    { name: 'Sample section 1', mark: 9, comment: 'Sample comment four. Suggestion: none.' },
    { name: 'Sample section 2', mark: 3, comment: 'Sample comment five. Suggestion: confirm it with a member.' },
  ],
};
const FOLDER = '/memory/Grillo/example-org/sample-project-1';

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const texts = (els: Iterable<Element>) => [...els].map(text);

function card(options: Partial<ScoreCardOptions> = {}) {
  const onRerun = vi.fn();
  const element = scoreCard({ version: 2, score: SCORE, canRerun: true, scoring: false, disabled: false, onRerun, ...options });
  document.body.append(element);
  const rerun = [...element.querySelectorAll('button')].find((each) => text(each) === 'Rerun');
  return { element, onRerun, rerun };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('PRD score: the score panel', () => {
  it('shows the overall mark out of 10, then one mark and comment per criterion and per section', () => {
    const { element } = card();

    expect(element.getAttribute('aria-label')).toBe('Score of version 2');
    const head = element.querySelector('.row') as HTMLElement;
    expect(texts(head.children)).toEqual(['Score', '6.3', 'out of 10', '', 'Rerun']);
    expect(text(element.querySelector('p'))).toBe(
      'Quality and coverage weigh half each, and every criterion and section weighs the same. The score is guidance, not a gate: nothing happens by itself after a low mark.',
    );
    expect(texts(element.querySelectorAll('h4'))).toEqual(['Quality', 'Coverage, per section of the PRD structure']);
    const [quality, coverage] = [...element.querySelectorAll('table')];
    // A mark cell reads as its badge; the bar repeats the same number for readers without progress bars.
    const rowsOf = (table: Element) => [...table.querySelectorAll('tr')].map((row) => [...row.children].map((cell) => text(cell.querySelector('.badge') ?? cell)));
    expect(rowsOf(quality)).toEqual([
      ['Criterion', 'Mark', 'Comment'],
      ['Clear', '8', SCORE.criteria[0].comment],
      ['Complete', '6', SCORE.criteria[1].comment],
      ['Scope and priorities', '4', SCORE.criteria[2].comment],
    ]);
    expect(rowsOf(coverage)).toEqual([
      ['Section', 'Mark', 'Comment'],
      ['Sample section 1', '9', SCORE.sections[0].comment],
      ['Sample section 2', '3', SCORE.sections[1].comment],
    ]);
  });

  it('draws each mark as a badge toned by how good it is and a bar out of 10', () => {
    const { element } = card();

    const badges = [...element.querySelectorAll('td .mark .badge')].map((badge) => [text(badge), badge.className]);
    expect(badges).toEqual([
      ['8', 'badge ok'],
      ['6', 'badge'],
      ['4', 'badge warn'],
      ['9', 'badge ok'],
      ['3', 'badge warn'],
    ]);
    const bar = element.querySelector('progress') as HTMLProgressElement;
    expect([bar.value, bar.max, bar.getAttribute('aria-label')]).toEqual([8, 10, 'Clear: 8 of 10']);
  });

  it('Rerun asks for a new score of the latest version, and is held while a scorer works or another action runs', () => {
    const ready = card();
    ready.rerun?.click();
    expect(ready.onRerun).toHaveBeenCalledOnce();

    const scoring = card({ scoring: true });
    expect(scoring.rerun?.disabled).toBe(true);
    expect(text(scoring.element.querySelector('.row .badge.warn'))).toBe('Scoring…');
    expect(card({ disabled: true }).rerun?.disabled).toBe(true);
  });

  it('offers no Rerun on an earlier version, since /grillo-score always scores the latest', () => {
    expect(card({ canRerun: false }).rerun).toBeUndefined();
  });

  it('says a version is not scored yet, with Rerun on the latest one', () => {
    const { element, rerun } = card({ score: null });

    expect(text(element.querySelector('h3'))).toBe('Score');
    expect(text(element.querySelector('p'))).toBe('This version has no score yet.');
    expect(element.querySelector('table')).toBeNull();
    expect(rerun?.disabled).toBe(false);
  });

  it('shows a stored comment as text, never as markup', () => {
    const comment = '<img src=x onerror=alert(1)> Suggestion: none.';
    const { element } = card({ score: { ...SCORE, criteria: [{ name: '<b>Clear</b>', mark: 7, comment }] } });

    expect(element.querySelector('img, td b')).toBeNull();
    expect(text(element.querySelector('table tr:nth-child(2)'))).toContain(comment);
  });

  it('shows a score it cannot read as an error inside the panel, and still offers Rerun', () => {
    const { element, rerun } = card({ score: { overall: 11, criteria: [], sections: [] } });

    expect(text(element.querySelector('.note.err'))).toBe('Grillo could not read the score of version 2 from the store.');
    expect(element.querySelector('table')).toBeNull();
    expect(rerun?.disabled).toBe(false);
  });
});

describe('PRD score: reading a stored score', () => {
  const item = { name: 'Clear', mark: 8, comment: 'Sample comment. Suggestion: none.' };

  it('keeps a well-formed score, and section names the current structure no longer has', () => {
    const renamed = { ...SCORE, sections: [{ name: 'A section removed since', mark: 0, comment: 'Sample. Suggestion: none.' }] };
    expect(checkedScore(SCORE, 2)).toEqual(SCORE);
    expect(checkedScore(renamed, 2)).toEqual(renamed);
    expect(checkedScore(null, 2)).toBeNull();
  });

  it.each([
    ['a missing score field', undefined],
    ['a score that is not an object', 'six'],
    ['no overall mark', { criteria: [item], sections: [item] }],
    ['a null overall mark', { overall: null, criteria: [item], sections: [item] }],
    ['an overall mark as text', { overall: '6.3', criteria: [item], sections: [item] }],
    ['an overall mark above 10', { overall: 10.5, criteria: [item], sections: [item] }],
    ['an overall mark below 0', { overall: -1, criteria: [item], sections: [item] }],
    ['an overall mark that is not a number', { overall: Number.NaN, criteria: [item], sections: [item] }],
    ['no criteria', { overall: 6, sections: [item] }],
    ['null sections', { overall: 6, criteria: [item], sections: null }],
    ['a null item', { overall: 6, criteria: [null], sections: [item] }],
    ['an item with no name', { overall: 6, criteria: [{ mark: 8, comment: 'x' }], sections: [item] }],
    ['an item with an empty name', { overall: 6, criteria: [item], sections: [{ ...item, name: '' }] }],
    ['an item with no mark', { overall: 6, criteria: [{ name: 'Clear', comment: 'x' }], sections: [item] }],
    ['an item mark above 10', { overall: 6, criteria: [item], sections: [{ ...item, mark: 11 }] }],
    ['an item mark below 0', { overall: 6, criteria: [{ ...item, mark: -2 }], sections: [item] }],
    ['an infinite item mark', { overall: 6, criteria: [{ ...item, mark: Number.POSITIVE_INFINITY }], sections: [item] }],
    ['an item with a null comment', { overall: 6, criteria: [{ ...item, comment: null }], sections: [item] }],
  ])('refuses %s as one backend error', (_case, stored) => {
    let refusal: unknown;
    try {
      checkedScore(stored, 3);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(StoreError);
    expect(refusal).toMatchObject({ kind: 'backend', message: 'Grillo could not read the score of version 3 from the store.' });
  });
});

describe('PRD score: the version list badge', () => {
  it('shows the overall mark of a scored version, to one decimal, and nothing for an unscored or unreadable one', () => {
    expect([text(scoreBadge(SCORE)), scoreBadge(SCORE)?.className]).toEqual(['Score 6.3', 'badge']);
    expect(text(scoreBadge({ ...SCORE, overall: 7 }))).toBe('Score 7.0');
    expect(scoreBadge(null)).toBeNull();
    expect(scoreBadge({ overall: 'high' })).toBeNull();
  });
});

describe('PRD score: the scorer agent', () => {
  it('starts /grillo-score in a grilling agent of the project folder', async () => {
    const invoke = vi.fn(async () => 'agent-7');
    const grillo = { invoke } as unknown as GrilloApi;

    await expect(startScore(grillo, FOLDER)).resolves.toBe('agent-7');
    expect(invoke).toHaveBeenCalledWith('agents:start', { kind: 'grilling', folder: FOLDER, firstMessage: '/grillo-score', title: 'Grilling · PRD score' });
  });

  it('counts a scorer of this project that is still working, and no other agent', () => {
    const agent = (id: string, title: string, folder: string, waiting: boolean): AgentInfo => ({ id, kind: 'grilling', title, folder, waiting });
    const agents = [
      agent('a', 'Grilling · PRD score', FOLDER, false),
      agent('b', 'Grilling · PRD score', FOLDER, true),
      agent('c', 'Grilling · PRD score', '/memory/Grillo/example-org/other', false),
      agent('d', 'Grilling · PRD', FOLDER, false),
    ];
    expect(workingScorers(agents, FOLDER).map(({ id }) => id)).toEqual(['a']);
  });
});
