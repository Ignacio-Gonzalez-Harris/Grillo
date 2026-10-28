import { describe, expect, it } from 'vitest';
import { StoreError } from '../../store';
import {
  formatComment,
  formatMapBody,
  formatTagsByHand,
  formatTicketBody,
  isTagsByHand,
  parseComment,
  parseMapBody,
  parseTagsByHand,
  parseTicketBody,
  type MapBody,
  type TicketBody,
} from './bodies';

const MAP: MapBody = {
  destination: 'A PRD for the sign-in flow',
  notes: 'Free text.\n\nOn two lines.',
  settled: [{ ticket: 12, gist: 'Sign in with GitHub only' }],
  fog: ['Pricing is unclear'],
  outOfScope: ['A mobile app'],
};

const TICKET: TicketBody = {
  question: 'How do members sign in?',
  whyItMatters: 'Every screen needs a member.',
  assumptions: ['GitHub accounts exist'],
  questions: [
    { k: 1, text: 'Which provider?' },
    { k: 2, text: null },
    { k: 3, text: 'Is single sign-on needed?' },
  ],
  blockers: [9],
};

function backendRefusal(parse: () => unknown): StoreError {
  let thrown: unknown;
  try {
    parse();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(StoreError);
  expect((thrown as StoreError).kind).toBe('backend');
  return thrown as StoreError;
}

describe('issue bodies: the map issue', () => {
  it('writes the five sections in the order docs/store-layout.md gives, and reads them back', () => {
    const body = formatMapBody(MAP);

    expect(body).toBe(
      [
        '### Destination',
        'A PRD for the sign-in flow',
        '',
        '### Notes',
        'Free text.',
        '',
        'On two lines.',
        '',
        '### Settled',
        '- #12 Sign in with GitHub only',
        '',
        '### Fog',
        '- Pricing is unclear',
        '',
        '### Out of scope',
        '- A mobile app',
        '',
      ].join('\n'),
    );
    expect(parseMapBody(body, 'issue #1')).toEqual(MAP);
  });

  it('keeps the heading of an empty section, and reads Windows line ends', () => {
    const empty: MapBody = { destination: '', notes: '', settled: [], fog: [], outOfScope: [] };

    expect(formatMapBody(empty)).toBe('### Destination\n\n### Notes\n\n### Settled\n\n### Fog\n\n### Out of scope\n');
    expect(parseMapBody(formatMapBody(MAP).replace(/\n/g, '\r\n'), 'issue #1')).toEqual(MAP);
  });

  it.each([
    ['an empty body', ''],
    ['a missing section', '### Destination\nx\n### Notes\n'],
    ['sections out of order', '### Notes\n\n### Destination\n\n### Settled\n\n### Fog\n\n### Out of scope\n'],
    ['an unknown section', `${formatMapBody(MAP)}### Extra\n`],
    ['text before the first section', `Hello\n${formatMapBody(MAP)}`],
    ['a settled line without a ticket number', formatMapBody(MAP).replace('- #12 ', '- 12 ')],
    ['a fog line that is not a list item', formatMapBody(MAP).replace('- Pricing', 'Pricing')],
  ])('refuses %s as a backend error naming the issue', (_case, body) => {
    expect(backendRefusal(() => parseMapBody(body, 'issue #1')).message).toContain('issue #1');
  });
});

describe('issue bodies: ticket issues', () => {
  it('writes the questions as Q<issue>.<k> lines, a removed one as (removed), and reads them back', () => {
    const body = formatTicketBody(TICKET, 12);

    expect(body).toContain('### Questions\n- Q12.1 Which provider?\n- Q12.2 (removed)\n- Q12.3 Is single sign-on needed?\n');
    expect(body).toContain('### Blocked by\n- #9\n');
    expect(parseTicketBody(body, 12, 'issue #12')).toEqual(TICKET);
  });

  it.each([
    ['a question of another ticket', formatTicketBody(TICKET, 12).replace('Q12.1', 'Q13.1')],
    ['a question code used twice', formatTicketBody(TICKET, 12).replace('Q12.3', 'Q12.1')],
    ['a question line without a code', formatTicketBody(TICKET, 12).replace('- Q12.1 ', '- ')],
    ['a code with a colon', formatTicketBody(TICKET, 12).replace('- Q12.1 ', '- Q12.1: ')],
    ['a code in brackets', formatTicketBody(TICKET, 12).replace('- Q12.1 ', '- [Q12.1] ')],
    ['a code with a hash', formatTicketBody(TICKET, 12).replace('- Q12.1 ', '- #Q12.1 ')],
    ['a code with an equals sign', formatTicketBody(TICKET, 12).replace('- Q12.1 ', '- Q12.1=')],
    ['a blocker that is not an issue number', formatTicketBody(TICKET, 12).replace('- #9', '- 9')],
    ['a blocker with text after it', formatTicketBody(TICKET, 12).replace('- #9', '- #9 login')],
  ])('refuses %s as a backend error', (_case, body) => {
    backendRefusal(() => parseTicketBody(body, 12, 'issue #12'));
  });
});

describe('issue bodies: comment markers', () => {
  const header = { id: '2412345678', who: 'ada-example', when: '2026-10-24T09:15:00.000Z', sources: ['S1', 'S4'] };

  it('writes an answer exactly as docs/store-layout.md shows it, and reads it back', () => {
    const answer = { kind: 'answer' as const, ...header, via: 'github' as const, question: 'Q12.1', from: '2412345678', text: 'Sign in with GitHub only.' };

    const body = formatComment(answer);

    expect(body).toBe(
      '<!-- grillo:answer -->\nwho: ada-example\nwhen: 2026-10-24T09:15:00.000Z\nsources: S1, S4\nvia: github\nquestion: Q12.1\nfrom: 2412345678\n\nSign in with GitHub only.',
    );
    expect(parseComment({ id: '2412345678', body, author: 'ada-example', createdAt: header.when })).toEqual(answer);
  });

  it('reads a discussion and a decision with empty header values as null and empty lists', () => {
    const discussion = { kind: 'discussion' as const, ...header, sources: [], via: null, question: 'Q12.1', session: null, transcript: 'Line one.\n\nLine two.' };
    const decision = { kind: 'decision' as const, ...header, via: 'generic-agent' as const, gist: 'GitHub only', text: 'We sign in with GitHub.' };

    for (const record of [discussion, decision]) {
      const raw = { id: header.id, body: formatComment(record), author: 'ada-example', createdAt: header.when };
      expect(parseComment(raw)).toEqual(record);
    }
    expect(formatComment(discussion)).toContain('\nsources:\nvia:\nquestion: Q12.1\nsession:\n\n');
  });

  it('reads a comment with no marker as a plain member comment, and one with an unknown Grillo marker as none of Grillo records', () => {
    const plain = { id: '7', body: 'Use GitHub, nothing else', author: 'ben-example', createdAt: header.when };

    expect(parseComment(plain)).toEqual({ kind: 'plain', id: '7', author: 'ben-example', when: header.when, text: 'Use GitHub, nothing else' });
    expect(parseComment({ ...plain, body: '<!-- grillo:future -->\nwho: x' })).toEqual({ kind: 'other', id: '7' });
  });

  it.each([
    ['a missing header line', '<!-- grillo:answer -->\nwho: ada-example\nwhen: x\n\ntext'],
    ['an unknown via', '<!-- grillo:decision -->\nwho: ada-example\nwhen: x\nsources:\nvia: email\ngist: g\n\ntext'],
    ['a source code that is not S<n>', '<!-- grillo:decision -->\nwho: ada-example\nwhen: x\nsources: S1, Q2.1\nvia:\ngist: g\n\ntext'],
    ['a who that is not a login', '<!-- grillo:decision -->\nwho: ada example\nwhen: x\nsources:\nvia:\ngist: g\n\ntext'],
    ['a question code with a colon', '<!-- grillo:answer -->\nwho: ada-example\nwhen: x\nsources:\nvia:\nquestion: Q12:1\nfrom:\n\ntext'],
    ['a from that is not a comment id', '<!-- grillo:answer -->\nwho: ada-example\nwhen: x\nsources:\nvia:\nquestion: Q12.1\nfrom: #7\n\ntext'],
    ['a session outside the sessions folder', '<!-- grillo:discussion -->\nwho: ada-example\nwhen: x\nsources:\nvia:\nquestion: Q12.1\nsession: ../secret.md\n\ntext'],
  ])('refuses a marked comment with %s as a backend error naming the comment', (_case, body) => {
    expect(backendRefusal(() => parseComment({ id: '42', body, author: 'ada-example', createdAt: header.when })).message).toContain('comment 42');
  });
});

describe('issue bodies: the tags-by-hand marker', () => {
  const record = { who: 'ada-example', when: '2026-10-25T10:00:00.000Z', domains: ['product', 'platform'], noDomain: false };

  it('writes the tags a member set by hand exactly as docs/store-layout.md shows it, and reads them back', () => {
    const body = formatTagsByHand(record);

    expect(body).toBe('<!-- grillo:tags-by-hand -->\nwho: ada-example\nwhen: 2026-10-25T10:00:00.000Z\ndomains: product, platform\n\n');
    expect(isTagsByHand(body)).toBe(true);
    expect(parseTagsByHand(body, 'comment 9')).toEqual(record);
  });

  it('writes the "no domain" tag as none, reads Windows line ends, and leaves every other comment alone', () => {
    const none = { ...record, domains: [], noDomain: true };

    expect(formatTagsByHand(none)).toContain('\ndomains: none\n');
    expect(parseTagsByHand(formatTagsByHand(none).replace(/\n/g, '\r\n'), 'comment 9')).toEqual(none);
    expect(parseComment({ id: '9', body: formatTagsByHand(none), author: 'ada-example', createdAt: record.when })).toEqual({ kind: 'other', id: '9' });
    expect([formatComment({ kind: 'decision', who: 'ada-example', when: record.when, sources: [], via: null, gist: 'g', text: 't' }), 'plain text', ''].map(isTagsByHand)).toEqual([false, false, false]);
  });

  it.each([
    ['another marker', '<!-- grillo:decision -->\nwho: ada-example\nwhen: x\ndomains: product\n\n'],
    ['a missing header line', '<!-- grillo:tags-by-hand -->\nwho: ada-example\ndomains: product\n\n'],
    ['a who that is not a login', '<!-- grillo:tags-by-hand -->\nwho: ada example\nwhen: x\ndomains: product\n\n'],
    ['no domain at all', '<!-- grillo:tags-by-hand -->\nwho: ada-example\nwhen: x\ndomains:\n\n'],
    ['none together with a domain', '<!-- grillo:tags-by-hand -->\nwho: ada-example\nwhen: x\ndomains: none, product\n\n'],
    ['an empty domain between commas', '<!-- grillo:tags-by-hand -->\nwho: ada-example\nwhen: x\ndomains: product,, platform\n\n'],
    ['one domain twice', '<!-- grillo:tags-by-hand -->\nwho: ada-example\nwhen: x\ndomains: product, product\n\n'],
    ['a domain written as its label', '<!-- grillo:tags-by-hand -->\nwho: ada-example\nwhen: x\ndomains: domain:product\n\n'],
  ])('refuses a tags-by-hand marker with %s as a backend error naming the comment', (_case, body) => {
    expect(backendRefusal(() => parseTagsByHand(body, 'comment 42')).message).toContain('comment 42');
  });
});
