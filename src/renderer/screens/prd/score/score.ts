/**
 * The score of a PRD version on the PRD view (PRD section 4.7 item 7, section 5 screen 8; prototype `screen-prd-view`
 * state `score`): the overall mark out of 10, one mark and comment per quality criterion and per section of the PRD
 * structure, and Rerun, which starts `/grillo-score` in a grilling agent (resources/skills/README.md, Commands).
 *
 * The score comes from the store with its version. Anything Grillo cannot read is refused with one `StoreError`
 * (`backend`), which the panel shows as its error; the PRD itself stays on show. `/grillo-score` takes no argument
 * and always scores the latest version, so only the latest version offers Rerun.
 */
import './score.css';
import type { Score, ScoreItem } from '../../../../main/store/types';
import { agentTitle, type AgentId, type AgentInfo } from '../../../../shared/agents';
import type { GrilloApi } from '../../../../shared/ipc';
import { StoreError } from '../../../../shared/store';
import { badge, button, type BadgeTone } from '../../../theme/components';
import { el, messageOf, note } from '../../own-time/view';

export const SCORE_COMMAND = '/grillo-score';
/** The scorer's tab name. */
export const PRD_SCORER_TITLE = agentTitle('grilling', 'PRD score');

const LOWEST_MARK = 0;
const HIGHEST_MARK = 10;
/** A mark from here up is good (the prototype's green badge); one at or below WEAK_MARK is weak (amber). */
const GOOD_MARK = 8;
const WEAK_MARK = 5;

const WEIGHT_TEXT =
  'Quality and coverage weigh half each, and every criterion and section weighs the same. The score is guidance, not a gate: nothing happens by itself after a low mark.';
const NOT_SCORED_TEXT = 'This version has no score yet.';

/** Starts the grader on the latest PRD version; a rerun replaces that version's score. */
export function startScore(grillo: GrilloApi, folder: string): Promise<AgentId> {
  return grillo.invoke('agents:start', { kind: 'grilling', folder, firstMessage: SCORE_COMMAND, title: PRD_SCORER_TITLE });
}

/** The project's scorers that are still working: running in its folder, and not waiting for the member. */
export function workingScorers(agents: readonly AgentInfo[], folder: string): AgentInfo[] {
  return agents.filter((agent) => agent.title === PRD_SCORER_TITLE && agent.folder === folder && !agent.waiting);
}

const isMark = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= LOWEST_MARK && value <= HIGHEST_MARK;

function isItem(value: unknown): value is ScoreItem {
  const item = value as Partial<Record<keyof ScoreItem, unknown>> | null;
  return typeof item === 'object' && item !== null && typeof item.name === 'string' && item.name !== '' && isMark(item.mark) && typeof item.comment === 'string';
}

const isItems = (value: unknown): value is ScoreItem[] => Array.isArray(value) && value.every(isItem);

/**
 * A version's stored score, checked before it is drawn: null while the version is not scored. Section names are kept
 * as stored, even one the structure has lost since: the score belongs to its version.
 */
export function checkedScore(value: unknown, version: number): Score | null {
  if (value === null) return null;
  const score = value as Partial<Record<keyof Score, unknown>> | undefined;
  if (typeof score !== 'object' || !isMark(score.overall) || !isItems(score.criteria) || !isItems(score.sections)) {
    throw new StoreError('backend', `Grillo could not read the score of version ${version} from the store.`);
  }
  return { overall: score.overall, criteria: score.criteria, sections: score.sections };
}

/** The overall mark as the prototype writes it: one decimal. */
const overallText = (overall: number): string => overall.toFixed(1);

/** "Score 6.3" for the version list; nothing for a version not scored, or whose score cannot be read. */
export function scoreBadge(value: unknown): HTMLSpanElement | null {
  try {
    const score = checkedScore(value, 0);
    return score === null ? null : badge(`Score ${overallText(score.overall)}`);
  } catch {
    return null;
  }
}

function markTone(mark: number): BadgeTone | undefined {
  if (mark >= GOOD_MARK) return 'ok';
  if (mark <= WEAK_MARK) return 'warn';
  return undefined;
}

function markCell({ name, mark }: ScoreItem): HTMLElement {
  const bar = el('progress', 'progress', [String(mark)]);
  bar.max = HIGHEST_MARK;
  bar.value = mark;
  bar.setAttribute('aria-label', `${name}: ${mark} of ${HIGHEST_MARK}`);
  return el('td', '', [el('div', 'mark', [badge(String(mark), markTone(mark)), bar])]);
}

function itemTable(label: string, items: readonly ScoreItem[]): HTMLElement {
  const head = el('tr', '', [el('th', '', [label]), el('th', '', ['Mark']), el('th', '', ['Comment'])]);
  const rows = items.map((item) => el('tr', '', [el('td', 'strong', [item.name]), markCell(item), el('td', '', [item.comment])]));
  return el('div', 'table-wrap', [el('table', 'small', [head, ...rows])]);
}

export interface ScoreCardOptions {
  /** The number of the version on show. */
  version: number;
  /** Its stored score, unchecked. */
  score: unknown;
  /** The version on show is the latest, the only one `/grillo-score` scores. */
  canRerun: boolean;
  /** A scorer of this project is working. */
  scoring: boolean;
  /** Another action of the screen is running. */
  disabled: boolean;
  onRerun(): void;
}

/** The score panel of the version on show. */
export function scoreCard(options: ScoreCardOptions): HTMLElement {
  let score: Score | null = null;
  let error: string | null = null;
  try {
    score = checkedScore(options.score, options.version);
  } catch (refusal) {
    error = messageOf(refusal);
  }

  const head = el('div', 'row', [el('h3', 'm0', ['Score'])]);
  if (score !== null) head.append(el('span', 'score-big', [overallText(score.overall)]), el('span', 'muted', [`out of ${HIGHEST_MARK}`]));
  // A scorer only ever scores the latest version, so only its panel is labelled Scoring and offers Rerun.
  if (options.canRerun) {
    if (options.scoring) head.append(badge('Scoring…', 'warn'));
    head.append(el('span', 'spacer'), button('Rerun', { disabled: options.disabled || options.scoring, onClick: options.onRerun }));
  }

  const body: HTMLElement[] = [];
  if (error !== null) body.push(note(error, 'err'));
  else if (score === null) body.push(el('p', 'small muted', [NOT_SCORED_TEXT]));
  else {
    body.push(
      el('p', 'small muted', [WEIGHT_TEXT]),
      el('h4', '', ['Quality']),
      itemTable('Criterion', score.criteria),
      el('h4', '', ['Coverage, per section of the PRD structure']),
      itemTable('Section', score.sections),
    );
  }

  const card = el('div', 'card stack prd-score', [head, ...body]);
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', `Score of version ${options.version}`);
  return card;
}
