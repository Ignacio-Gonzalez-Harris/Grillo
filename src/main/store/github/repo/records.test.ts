import { describe, expect, it } from 'vitest';
import { StoreError } from '../../store';
import type { GrillingSession, PrdVersion, Score, Source } from '../../types';
import {
  formatMembers,
  formatPrdVersion,
  formatScore,
  formatSession,
  formatSource,
  formatStructure,
  parseMembers,
  parsePrdVersion,
  parseScore,
  parseSession,
  parseSource,
  parseStructure,
} from './records';

const FILE = '.grillo/example';

function refusal(read: () => unknown): StoreError {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(StoreError);
    return error as StoreError;
  }
  throw new Error('expected the read to be refused');
}

describe('Grillo folder records', () => {
  it('round-trips every record through its file format, as docs/store-layout.md shows it', () => {
    const members = [{ login: 'ada-example', role: 'developer', domains: ['platform'] }];
    const structure = { sections: [{ name: 'Problem', note: 'What goes wrong today' }] };
    const source: Source = {
      code: 'S2',
      kind: 'pasted-text',
      who: 'Ben Example, product',
      when: '2026-10-23T10:00:00.000Z',
      where: 'email to Ada',
      text: 'First line.\n\nA paragraph after an empty line.',
    };
    const session: GrillingSession = {
      id: '2026-10-24-091500',
      date: '2026-10-24T09:15:00.000Z',
      present: ['ada-example', 'ben-example'],
      consent: { by: 'ada-example', at: '2026-10-24T09:16:00.000Z' },
      transcript: 'The transcript, as spoken.',
    };
    const version: PrdVersion = {
      number: 2,
      date: '2026-10-24T11:00:00.000Z',
      body: '# The PRD body\n\nWith [S1, Q12.1] codes.\n',
      appendix: '# Audit appendix\n',
      score: null,
    };
    const score: Score = {
      overall: 6.5,
      criteria: [{ name: 'Clear', mark: 7, comment: 'Mostly plain words' }],
      sections: [{ name: 'Problem', mark: 6, comment: 'Outcomes are vague' }],
    };

    expect(parseMembers(formatMembers(members), FILE)).toEqual(members);
    expect(parseStructure(formatStructure(structure), FILE)).toEqual(structure);
    expect(parseSource(formatSource(source), 'S2', FILE)).toEqual(source);
    expect(parseSession(formatSession(session), session.id, FILE)).toEqual(session);
    expect(parsePrdVersion(formatPrdVersion(version), FILE)).toEqual(version);
    expect(parseScore(formatScore(score), FILE)).toEqual(score);
    expect(formatSource(source)).toBe(
      'kind: pasted-text\nwho: Ben Example, product\nwhen: 2026-10-23T10:00:00.000Z\nwhere: email to Ada\n\n' + source.text,
    );
  });

  it('writes a line break inside a header value as a space, and an empty list or consent as an empty value', () => {
    const empty: GrillingSession = { id: '2026-10-24-091500', date: '2026-10-24T09:15:00.000Z', present: [], consent: null, transcript: '' };
    const text = formatSession(empty);
    const source = formatSource({ code: 'S1', kind: 'meeting', who: 'Ben\r\nExample', when: 'x', where: 'call', text: 't' });

    expect(text).toBe('date: 2026-10-24T09:15:00.000Z\npresent:\nconsent-by:\nconsent-at:\n\n');
    expect(parseSession(text, empty.id, FILE)).toEqual(empty);
    expect(source.split('\n')[1]).toBe('who: Ben Example');
  });

  it('reads files checked out with Windows line endings', () => {
    const source = parseSource('kind: meeting\r\nwho: Ben\r\nwhen: w\r\nwhere: call\r\n\r\nLine one\r\nLine two', 'S1', FILE);

    expect(source).toMatchObject({ who: 'Ben', text: 'Line one\nLine two' });
  });

  it('splits a PRD version at the first appendix marker line; a file without one has an empty appendix', () => {
    const marker = '<!-- grillo:appendix -->';
    const twoMarkers = `version: 1\ndate: d\n\nBody\n${marker}\nAppendix\n${marker}\nmore`;

    expect(parsePrdVersion(twoMarkers, FILE)).toMatchObject({ body: 'Body', appendix: `Appendix\n${marker}\nmore` });
    expect(parsePrdVersion('version: 1\ndate: d\n\nOnly a body', FILE)).toMatchObject({ body: 'Only a body', appendix: '' });
    expect(parsePrdVersion(`version: 1\ndate: d\n\n${marker}\nAppendix`, FILE)).toMatchObject({ body: '', appendix: 'Appendix' });
  });

  it.each([
    ['not JSON', '{'],
    ['not a list', '{"login":"ada-example"}'],
    ['a null entry', '[null]'],
    ['an entry without a login', '[{"role":"","domains":[]}]'],
    ['a login that is not a GitHub login', '[{"login":"../ada","role":"","domains":[]}]'],
    ['domains that are not a list of text', '[{"login":"ada-example","role":"","domains":[null]}]'],
    ['a role that is not text', '[{"login":"ada-example","role":3,"domains":[]}]'],
    ['the same login twice', '[{"login":"ada-example","role":"","domains":[]},{"login":"ada-example","role":"","domains":[]}]'],
    ['the same login twice in different case', '[{"login":"ada-example","role":"","domains":[]},{"login":"Ada-Example","role":"","domains":[]}]'],
  ])('refuses a members file with %s as a backend error naming the file', (_case, text) => {
    expect(refusal(() => parseMembers(text, FILE))).toMatchObject({ kind: 'backend', message: expect.stringContaining(FILE) });
  });

  it.each([
    ['not JSON', 'sections'],
    ['no sections list', '{}'],
    ['a null section', '{"sections":[null]}'],
    ['a section without a note', '{"sections":[{"name":"Problem"}]}'],
  ])('refuses a structure file with %s', (_case, text) => {
    expect(refusal(() => parseStructure(text, FILE)).kind).toBe('backend');
  });

  it.each([
    ['null', 'null'],
    ['an overall that is not a number', '{"overall":"6","criteria":[],"sections":[]}'],
    ['a null criterion', '{"overall":6,"criteria":[null],"sections":[]}'],
    ['a section without a comment', '{"overall":6,"criteria":[],"sections":[{"name":"P","mark":6}]}'],
  ])('refuses a score file with %s', (_case, text) => {
    expect(refusal(() => parseScore(text, FILE)).kind).toBe('backend');
  });

  it.each([
    ['no header block', 'just text'],
    ['a header line missing', 'kind: meeting\nwho: Ben\nwhere: call\n\ntext'],
    ['header lines out of order', 'who: Ben\nkind: meeting\nwhen: w\nwhere: call\n\ntext'],
    ['an unknown kind', 'kind: rumour\nwho: Ben\nwhen: w\nwhere: call\n\ntext'],
    ['a header line without a colon', 'kind meeting\nwho: Ben\nwhen: w\nwhere: call\n\ntext'],
  ])('refuses a source file with %s', (_case, text) => {
    expect(refusal(() => parseSource(text, 'S1', FILE)).kind).toBe('backend');
  });

  it.each([
    ['a session with consent by someone but no moment', 'date: d\npresent: ada-example\nconsent-by: ada-example\nconsent-at:\n\n'],
    ['a PRD version whose number is not a number', 'version: two\ndate: d\n\nbody'],
  ])('refuses %s', (_case, text) => {
    const read = text.startsWith('version') ? () => parsePrdVersion(text, FILE) : () => parseSession(text, 'id', FILE);
    expect(refusal(read).kind).toBe('backend');
  });
});
