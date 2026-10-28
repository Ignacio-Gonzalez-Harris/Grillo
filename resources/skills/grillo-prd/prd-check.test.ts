import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { FixtureError, readFixtureFolder } from '../fixture-check';
import { checkPrdFixture } from './prd-check';

/**
 * The PRD checker's refusals, each made by changing one thing in the made-up fixture `after-feedback`, which passes
 * as it is. Every broken rule must come back as a `FixtureError` naming what is wrong.
 */

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'after-feedback');
const V1 = '.grillo/prd/v1.md';
const V2 = '.grillo/prd/v2.md';

let fixture: Record<string, string>;

beforeAll(async () => {
  const files = await readFixtureFolder(FIXTURE);
  fixture = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, text.replace(/\r\n/g, '\n')]));
});

/** The fixture with one file's text changed; a replacement that matches nothing fails the test, not the check. */
function withChange(path: string, from: string, to: string): Record<string, string> {
  expect(fixture[path], `${path} holds '${from}'`).toContain(from);
  return { ...fixture, [path]: fixture[path].replace(from, to) };
}

const BORROW = '- A member borrows at the shed by holding their garden key card to the reader.';
const KEEP = '- A member keeps a tool for at most a week.';
const S1_ENTRY = [
  '### S1',
  '- Kind: pasted-text',
  '- Who: Ada Example, product',
  '- When: 2026-10-24T08:00:00.000Z',
  '- Where: typed into Grillo when the project was created',
  '',
  '> The Elm Street community garden keeps its tools in a shed.',
].join('\n');
const S8_ENTRY = [
  '### S8',
  '- Kind: own-time-answer',
  '- Who: Ada Example, product',
  '- When: 2026-10-26T14:00:00.000Z',
  '- Where: Grillo, PRD feedback chat on ticket #7',
  '',
  '> Yes. The screen lists every tool that is out and who has it, right now.',
].join('\n');

describe('checkPrdFixture', () => {
  it('passes the fixture as it is', () => {
    expect(checkPrdFixture(fixture).versions.map((version) => version.number)).toEqual([1, 2]);
  });

  it.each<[string, string, RegExp]>([
    ['no tag at all', `${BORROW}`, /does not end with its codes or \[no source\]/],
    ['no space after the comma', `${BORROW} [S2,Q2.1]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['a semicolon between codes', `${BORROW} [S2; Q2.1]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['an equals sign between codes', `${BORROW} [S2=Q2.1]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['a hash before the issue number', `${BORROW} [S2, Q#2.1]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['a leading zero', `${BORROW} [S02, Q2.1]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['a question with no k', `${BORROW} [S2, Q2]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['k zero', `${BORROW} [S2, Q2.0]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['a lowercase code', `${BORROW} [s2, Q2.1]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['a map-ticket code', `${BORROW} [T3]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['an empty tag', `${BORROW} []`, /not S<n> and then Q<issue>\.<k> codes/],
    ['no source mixed with codes', `${BORROW} [no source, S2]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['a question before its source', `${BORROW} [Q2.1, S2]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['a source with no question', `${BORROW} [S2]`, /not S<n> and then Q<issue>\.<k> codes/],
    ['a code twice', `${BORROW} [S2, Q2.1, Q2.1]`, /name a code twice/],
    ['the statement broken over two lines', `${BORROW}\n  and pick the tool on the screen. [S2, Q2.1]`, /does not end with its codes/],
  ])('refuses a statement tag with %s', (_, line, why) => {
    expect(() => checkPrdFixture(withChange(V2, `${BORROW} [S2, Q2.1]`, line))).toThrow(why);
  });

  it.each<[string, string, string, RegExp]>([
    ['a question of no ticket', `${BORROW} [S2, Q2.1]`, `${BORROW} [S2, Q9.1]`, /#9 is no ticket/],
    ['a removed question', `${KEEP} [S3, Q2.3]`, `${KEEP} [S3, Q2.2]`, /does not hold or removed/],
    ['a source no cited answer rests on', `${BORROW} [S2, Q2.1]`, `${BORROW} [S2, S3, Q2.1]`, /cites S3, which no answer to its questions rests on/],
    ["a question without its answer's source", `${KEEP} [S3, Q2.3]`, `${KEEP} [S2, Q2.1, Q2.3]`, /cites Q2\.3 without the source its answer rests on/],
    ['a source with no file', `${BORROW} [S2, Q2.1]`, `${BORROW} [S2, S9, Q2.1]`, /S9, which has no source file/],
  ])('refuses a statement that cites %s', (_, from, to, why) => {
    expect(() => checkPrdFixture(withChange(V2, from, to))).toThrow(why);
  });

  it('refuses a version citing a question decided after the version was written', () => {
    const files = withChange(V1, '- The shed screen shows who has each tool right now. [no source]', '- The shed screen shows who has each tool right now. [S8, Q7.1]');

    expect(() => checkPrdFixture(files)).toThrow(/ticket #7 had no decision when the version was written/);
  });

  it('refuses a written section that rests on no decision of its own', () => {
    const files = withChange(V2, '- Only members who hold a key card may lend tools. [S4, Q3.1]\n- Only the shed keeper may take a lent tool out of the shed for good. [S5, Q3.2]', '- Lending follows the borrowing rules. [S2, Q2.1]');

    expect(() => checkPrdFixture(files)).toThrow(/section 'Permissions' is written, but none of its statements cites a decided question/);
  });

  it.each<[string, string, string, string, RegExp]>([
    ['names an entry with no code', V2, '### S8\n- Kind', '### S7x\n- Kind', /'### S7x' under Sources names no source code/],
    ['lists a code no statement cites', V2, '### S2\n', `${S1_ENTRY}\n\n### S2\n`, /misses \[\] and lists uncited \[S1\]/],
    ['leaves out a cited source', V2, `\n${S8_ENTRY}\n`, '\n', /misses \[S8\] and lists uncited \[\]/],
    ['changes a source\'s exact words', V2, '> Of the 40 tools on the list, 6 could not be found', '> Of the 40 tools on the list, 7 could not be found', /entry S6 is not the source file's who, when, where and exact words/],
    ['names the wrong recorder of an answer', V2, '- Who: ben-example\n- When: 2026-10-24T13:01:00.000Z', '- Who: ada-example\n- When: 2026-10-24T13:01:00.000Z', /entry Q3\.1 is not its question, its ticket and one of its answers/],
    ['leaves out a [no source] statement', V1, '- Flows: The shed screen shows who has each tool right now.', 'None.', /Unsourced part does not list every \[no source\] statement/],
    ['lists sources out of order', V2, '### S2\n', '### S9\n', /S3 comes after S9/],
    ['drops the exact words of an entry', V2, '\n> Members borrow at the shed with their garden key card.\n', '\n', /entry Q2\.1 must end with an empty line and its exact words/],
    ['has its parts out of order', V2, '## Questions', '## Unsourced\n\n## Questions', /not exactly Sources, Questions, Unsourced/],
  ])('refuses an appendix that %s', (_, path, from, to, why) => {
    expect(() => checkPrdFixture(withChange(path, from, to))).toThrow(why);
  });

  it('refuses an appendix entry with no fields before its exact words', () => {
    const files = withChange(V2, '### S2\n- Kind: own-time-answer\n', '### S2\n');

    expect(() => checkPrdFixture(files)).toThrow(FixtureError);
  });

  it.each<[string, (files: Record<string, string>) => Record<string, string>, RegExp]>([
    ['a gap in the version numbers', (files) => renamed(files, V2, '.grillo/prd/v3.md'), /v2 is missing: version numbers run from v1 with no gap/],
    ['a version line that is not its file number', (files) => ({ ...files, [V2]: files[V2].replace('version: 2', 'version: 3') }), /says 'version: 3'/],
    ['a later version dated before an earlier one', (files) => ({ ...files, [V2]: files[V2].replace('date: 2026-10-26T15:00:00.000Z', 'date: 2026-10-25T09:00:00.000Z') }), /not after v1/],
    ['a date that is no UTC moment', (files) => ({ ...files, [V2]: files[V2].replace('date: 2026-10-26T15:00:00.000Z', 'date: 26/10/2026') }), /is not a moment in ISO 8601 UTC/],
    ['no appendix marker', (files) => ({ ...files, [V2]: files[V2].replace('<!-- grillo:appendix -->\n', '') }), /has no audit appendix/],
    ['the appendix marker twice', (files) => ({ ...files, [V2]: `${files[V2]}\n<!-- grillo:appendix -->\n` }), /appears twice/],
    ['a line outside every section', (files) => ({ ...files, [V2]: files[V2].replace('# Elm Street tool share\n', '# Elm Street tool share\n\nAn introduction.\n') }), /stands outside every section/],
    ['a section written twice', (files) => ({ ...files, [V2]: files[V2].replace('## Permissions', '## Flows') }), /section 'Flows' is written twice/],
    ['no title', (files) => ({ ...files, [V2]: files[V2].replace('# Elm Street tool share\n', '') }), /does not start with a '# ' title/],
    ['a file in the PRD folder that is no version', (files) => ({ ...files, '.grillo/prd/v2-draft.md': files[V2] }), /neither v<n>\.md nor v<n>\.score\.json/],
    ['a missing header line', (files) => ({ ...files, [V2]: files[V2].replace('version: 2\n', '') }), /not in the format Grillo writes/],
  ])('refuses %s', (_, change, why) => {
    expect(() => checkPrdFixture(change(fixture))).toThrow(why);
  });
});

function renamed(files: Record<string, string>, from: string, to: string): Record<string, string> {
  const { [from]: text, ...rest } = files;
  return { ...rest, [to]: text.replace(/^version: \d+/, `version: ${to.match(/v(\d+)/)?.[1]}`) };
}
