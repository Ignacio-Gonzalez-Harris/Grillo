import { parseScore } from '../../../src/main/store/github/repo/records';
import { StoreError } from '../../../src/main/store/store';
import type { Score } from '../../../src/main/store/types';
import { FixtureError } from '../fixture-check';
import { type CheckedPrdFixture, checkPrdFixture, type ReadPrdVersion } from '../grillo-prd/prd-check';

/**
 * Checks the score files in a skill's fixture, `.grillo/prd/v<n>.score.json`, against the store's `Score` type
 * (`docs/store-layout.md`) and the rules `grillo-score` scores by (its `references/score-format.md`): exactly the
 * Score fields, the eight quality criteria in order, every section the version writes scored in the version's order
 * (a section it does not write marked 0), whole marks from 0 to 10, one one-line comment per item holding its
 * suggestion, no Grillo marker and no code the version does not cite, and an overall that is the mean of the two
 * equal halves. The project and its versions are checked first with `checkPrdFixture`; every refusal is a
 * `FixtureError`.
 */

/** The quality half, from ISO/IEC/IEEE 29148, INCOSE and product-management guides (PRD 4.7 item 7), in order. */
export const CRITERIA = [
  'Clear',
  'Complete',
  'Verifiable',
  'Tied to objectives',
  'Consistent',
  'Feasible',
  'Needs, not solutions',
  'Scope and priorities',
] as const;

export interface CheckedScore {
  /** The number of the version it scores. */
  number: number;
  score: Score;
}

export interface CheckedScoreFixture extends CheckedPrdFixture {
  /** Every score file, v1's first. */
  scores: CheckedScore[];
}

const LOWEST_MARK = 0;
const HIGHEST_MARK = 10;
const SCORE_FIELDS = ['overall', 'criteria', 'sections'];
const ITEM_FIELDS = ['name', 'mark', 'comment'];
const SCORE_FILE = /^\.grillo\/prd\/v([1-9]\d*)\.score\.json$/;
const SUGGESTION = 'Suggestion: ';
const GRILLO_MARKER = '<!-- grillo:';
/** A source or question code standing on its own: not part of a longer word, number or code (`MS9`, `Q2.3.4`). */
const CITED_CODE = /(?<![A-Za-z0-9_.])(S[1-9]\d*|Q[1-9]\d*\.[1-9]\d*)(?![A-Za-z0-9_]|\.\d)/g;

function fail(why: string): never {
  throw new FixtureError(why);
}

const unixLines = (text: string): string => text.replace(/\r\n/g, '\n');
const mean = (marks: number[]): number => marks.reduce((sum, mark) => sum + mark, 0) / marks.length;

/** The overall mark: quality and coverage weigh half each, every mark in a half weighs the same, one decimal. */
export function overallOf(criteria: number[], sections: number[]): number {
  return Math.round(((mean(criteria) + mean(sections)) / 2) * 10) / 10;
}

function objectOf(value: unknown, what: string, fields: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${what} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) {
    fail(`${what} holds [${keys.join(', ')}], not exactly the Score fields [${fields.join(', ')}]`);
  }
  return value as Record<string, unknown>;
}

/** Every code a version's statements cite. */
function citedCodes(version: ReadPrdVersion): Set<string> {
  return new Set(version.sections.flatMap((section) => section.statements.flatMap((statement) => statement.codes ?? [])));
}

function checkItem(value: unknown, what: string, cited: Set<string>): { name: string; mark: number; comment: string } {
  const item = objectOf(value, what, ITEM_FIELDS);
  const { name, mark, comment } = item;
  if (typeof name !== 'string' || name.trim() === '') {
    fail(`${what} needs a name`);
  }
  if (typeof mark !== 'number' || !Number.isInteger(mark) || mark < LOWEST_MARK || mark > HIGHEST_MARK) {
    fail(`${what} '${name}' is marked ${String(mark)}, not a whole number from ${LOWEST_MARK} to ${HIGHEST_MARK}`);
  }
  if (typeof comment !== 'string' || comment.trim() === '' || /[\r\n]/.test(comment)) {
    fail(`${what} '${name}' needs one comment on one line`);
  }
  if (!comment.includes(SUGGESTION)) {
    fail(`${what} '${name}': its comment says what is weak and why, then '${SUGGESTION}' and a concrete suggestion`);
  }
  if (comment.includes(GRILLO_MARKER)) {
    fail(`${what} '${name}': its comment holds a Grillo marker`);
  }
  for (const [code] of comment.matchAll(CITED_CODE)) {
    if (!cited.has(code)) {
      fail(`${what} '${name}': its comment cites ${code}, which the version never cites`);
    }
  }
  return { name, mark, comment };
}

/** Reads one score file of a version; refuses anything not in the shape `grillo-score` writes. */
export function readScore(content: string, version: ReadPrdVersion, file: string): Score {
  const text = unixLines(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${file} is not JSON: ${(error as Error).message}`);
  }
  const fields = objectOf(parsed, file, SCORE_FIELDS);
  for (const list of ['criteria', 'sections'] as const) {
    if (!Array.isArray(fields[list])) {
      fail(`${file}: '${list}' must be a list`);
    }
  }
  const cited = citedCodes(version);
  const criteria = (fields.criteria as unknown[]).map((item, index) => checkItem(item, `${file} criterion ${index + 1}`, cited));
  const sections = (fields.sections as unknown[]).map((item, index) => checkItem(item, `${file} section ${index + 1}`, cited));

  const criteriaNames = criteria.map((item) => item.name);
  if (criteriaNames.join('|') !== CRITERIA.join('|')) {
    fail(`${file} scores the criteria [${criteriaNames.join(', ')}], not exactly [${CRITERIA.join(', ')}] in that order`);
  }

  const sectionNames = sections.map((item) => item.name);
  const written = version.sections.map((section) => section.name);
  if (sections.length === 0) {
    fail(`${file} scores no section`);
  }
  if (new Set(sectionNames).size !== sectionNames.length) {
    fail(`${file} scores a section twice`);
  }
  const unscored = written.filter((name) => !sectionNames.includes(name));
  if (unscored.length > 0) {
    fail(`${file} leaves the written sections [${unscored.join(', ')}] unscored`);
  }
  if (sectionNames.filter((name) => written.includes(name)).join('|') !== written.join('|')) {
    fail(`${file} scores the sections out of the order v${version.number} writes them in`);
  }
  for (const item of sections.filter((candidate) => !written.includes(candidate.name))) {
    if (item.mark !== LOWEST_MARK) {
      fail(`${file}: '${item.name}', which v${version.number} does not write, is marked ${item.mark}; a section with no decision is marked ${LOWEST_MARK}`);
    }
  }

  const expected = overallOf(
    criteria.map((item) => item.mark),
    sections.map((item) => item.mark),
  );
  if (fields.overall !== expected) {
    fail(`${file}: the overall is ${String(fields.overall)}, where the two halves give ${expected}`);
  }

  try {
    return parseScore(text, file);
  } catch (error) {
    if (error instanceof StoreError) {
      fail(error.message);
    }
    throw error;
  }
}

/** Checks a fixture's project, its PRD versions and every score file; refuses anything that breaks the rules with `FixtureError` only. */
export function checkScoreFixture(input: Record<string, string>): CheckedScoreFixture {
  const prd = checkPrdFixture(input);
  const scores = Object.entries(input)
    .flatMap(([path, text]) => {
      const number = SCORE_FILE.exec(path)?.[1];
      return number === undefined ? [] : [{ path, text, number: Number(number) }];
    })
    .sort((a, b) => a.number - b.number)
    .map(({ path, text, number }) => {
      const version = prd.versions.find((candidate) => candidate.number === number) ?? fail(`${path} scores v${number}, which is not written`);
      return { number, score: readScore(text, version, path) };
    });
  return { ...prd, scores };
}
