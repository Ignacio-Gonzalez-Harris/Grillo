import type { AnswerComment, DiscussionComment, MarkedComment } from '../../src/main/store/github/issues/bodies';
import { sameLogin } from '../../src/main/store/github/repo/names';
import type { Source } from '../../src/main/store/types';
import { checkProjectFixture, type CheckedTicket } from './fixture-check';

/**
 * Checks what one run of a kind agent (`/grillo-research`, `/grillo-prototype` or `/grillo-task`) did to a project,
 * given made-up snapshots of the project before and after it: the run works the one ticket it was started on, of its
 * own kind, records as the member who runs it, rests every answer on the kind of source its skill teaches, keeps
 * every earlier record, and ends with the ticket closed with a decision or released to the pool. Both snapshots are
 * first checked against the store layout by `checkProjectFixture`.
 */

/** The ticket kinds a kind agent of release 3 works, each with its own command. */
export const KIND_AGENTS = ['research', 'prototype', 'task'] as const;
export type KindAgent = (typeof KIND_AGENTS)[number];

export interface KindRun {
  kind: KindAgent;
  /** The ticket the command named. */
  ticket: number;
  /** The login of the member who runs the agent. */
  runner: string;
}

export interface KindRunOutcome {
  /** Every way the run broke the rules of its kind. */
  problems: string[];
  /** The tickets the run closed. */
  closed: number[];
  /** The run closed a ticket and left no open ticket and no fog: the map-done rule starts `/grillo-prd`. */
  prdDue: boolean;
}

const MANIFEST = 'issues.json';
const TICKET_BODY = /^issues\/[1-9]\d*\.md$/;
const COMMENT_FILE = /^comments\/[1-9]\d*\.md$/;
const SOURCE_FILE = /^\.grillo\/sources\/S[1-9]\d*\.md$/;
/** A Windows drive path or a home folder on a Mac or Linux laptop: never written on a ticket or into a source. */
const MACHINE_PATH = /\b[A-Za-z]:[\\/]|(?:^|[\s(`'"])\/(?:Users|home|tmp|var)\//m;
const LINK = /https?:\/\/\S+/;

/** A source a `use it` chunk gives: the live session it was cut from, or the pasted transcript. */
const isChunkSource = (source: Source): boolean => source.kind === 'meeting' || source.kind === 'pasted-text';
const isChatSource = (source: Source, ticket: number): boolean =>
  source.kind === 'own-time-answer' && source.where === `Grillo, own-time chat on ticket #${ticket}`;

/** The sources each kind's answers rest on, as its skill teaches them. */
const KIND_SOURCES: Record<KindAgent, { what: string; fits(source: Source, ticket: number): boolean }> = {
  research: {
    what: 'a document with its link, the runner\'s own words in the chat, or a transcript chunk',
    fits: (source, ticket) => (source.kind === 'document' && LINK.test(source.where)) || isChatSource(source, ticket) || isChunkSource(source),
  },
  prototype: {
    what: 'the runner\'s reaction in the chat, or a transcript chunk',
    fits: (source, ticket) => isChatSource(source, ticket) || isChunkSource(source),
  },
  task: {
    what: 'the task agent\'s work record, the runner\'s report in the chat, or a transcript chunk',
    fits: (source, ticket) =>
      (source.kind === 'document' && source.where === `Grillo, task agent on ticket #${ticket}`) || isChatSource(source, ticket) || isChunkSource(source),
  },
};

/** Whether a source is one a kind agent's answer may rest on: the shapes its skill teaches for that kind. */
export const sourceFitsKind = (source: Source, kind: KindAgent, ticket: number): boolean => KIND_SOURCES[kind].fits(source, ticket);

const liveCodes = (ticket: CheckedTicket): string[] => ticket.body.questions.filter((question) => question.text !== null).map((question) => `Q${ticket.number}.${question.k}`);
const isAnswered = (ticket: CheckedTicket, code: string): boolean => ticket.comments.some((comment) => comment.kind === 'answer' && comment.question === code);
const everyQuestionAnswered = (ticket: CheckedTicket): boolean => liveCodes(ticket).every((code) => isAnswered(ticket, code));

/** Checks one kind agent's run; the snapshots are `{ path: text }` folders as `readFixtureFolder` reads them. */
export function checkKindRun(beforeFiles: Record<string, string>, afterFiles: Record<string, string>, run: KindRun): KindRunOutcome {
  const problems: string[] = [];
  const before = checkProjectFixture(beforeFiles);
  const after = checkProjectFixture(afterFiles);
  const earlierSources = new Set(before.sources.map((source) => source.code));
  const sourceOf = (code: string): Source | undefined => after.sources.find((source) => source.code === code);

  for (const path of Object.keys(beforeFiles)) {
    const mayChange = path === MANIFEST || TICKET_BODY.test(path);
    if (!mayChange && beforeFiles[path] !== afterFiles[path]) {
      problems.push(`the run changed the file ${path}`);
    }
  }
  for (const path of Object.keys(afterFiles).filter((name) => !(name in beforeFiles))) {
    if (!COMMENT_FILE.test(path) && !SOURCE_FILE.test(path)) {
      problems.push(`the run wrote the file ${path}, which is no source and no comment`);
    } else if (MACHINE_PATH.test(afterFiles[path])) {
      problems.push(`the run wrote an absolute machine path into ${path}`);
    }
  }
  if (after.map.destination !== before.map.destination || after.map.notes !== before.map.notes) {
    problems.push('the run changed the map destination or notes');
  }

  const closed: number[] = [];
  for (const earlier of before.tickets) {
    const ticket = after.tickets.find((candidate) => candidate.number === earlier.number);
    if (ticket === undefined) {
      problems.push(`ticket #${earlier.number} is gone`);
      continue;
    }
    const name = `ticket #${ticket.number}`;
    if ([...earlier.labels].sort().join() !== [...ticket.labels].sort().join()) {
      problems.push(`the run changed the labels of ${name}`);
    }
    for (const question of earlier.body.questions) {
      const now = ticket.body.questions.find((line) => line.k === question.k);
      if (now === undefined || (now.text !== null && now.text !== question.text)) {
        problems.push(`the run changed or dropped question Q${ticket.number}.${question.k}`);
      }
    }
    for (const comment of earlier.comments) {
      if (!ticket.comments.some((other) => JSON.stringify(other) === JSON.stringify(comment))) {
        problems.push(`the run edited or deleted comment ${comment.id} on ${name}`);
      }
    }
    if (earlier.state === 'closed' && ticket.state === 'open') {
      problems.push(`the run reopened ${name}`);
    }
    if (earlier.state === 'open' && ticket.state === 'closed') {
      closed.push(ticket.number);
    }

    const added = ticket.comments.filter((comment) => !earlier.comments.some((other) => other.id === comment.id));
    const marked = added.filter((comment): comment is MarkedComment => comment.kind !== 'plain' && comment.kind !== 'other');
    if (ticket.number !== run.ticket) {
      if (added.length > 0 || ticket.state !== earlier.state || ticket.assignee !== earlier.assignee) {
        problems.push(`the run wrote on ${name}, which it was not started on`);
      }
      continue;
    }

    if (ticket.kind !== run.kind) {
      problems.push(`the ${run.kind} agent worked ${name}, a ${ticket.kind} ticket`);
    }
    for (const comment of added.filter((candidate) => candidate.kind === 'plain' || candidate.kind === 'other')) {
      problems.push(`the run wrote the comment ${comment.id} on ${name} with no Grillo record marker`);
    }
    for (const comment of marked) {
      if (!sameLogin(comment.who, run.runner)) {
        problems.push(`comment ${comment.id} on ${name} was recorded by ${comment.who}, not by the member running the agent`);
      }
      if (comment.via !== null || (comment.kind === 'answer' && comment.from !== null)) {
        problems.push(`comment ${comment.id} on ${name}, recorded by a ${run.kind} agent, is marked as turned from GitHub or another agent`);
      }
    }
    checkSources(marked.filter((comment): comment is AnswerComment => comment.kind === 'answer'), name);
    checkDiscussions(ticket, marked, name);

    if (ticket.state === 'open' && ticket.assignee !== null) {
      problems.push(`the run left ${name} held by ${ticket.assignee} after done, with questions still open`);
    }
    if (ticket.state === 'open' && everyQuestionAnswered(ticket)) {
      problems.push(`the run left ${name} open with every question answered`);
    }
  }

  /** Every answer rests on a source of its kind, and every source the run wrote for it is of its kind. */
  function checkSources(answers: AnswerComment[], name: string): void {
    const rule = KIND_SOURCES[run.kind];
    for (const answer of answers) {
      const cited = answer.sources.map(sourceOf).filter((source): source is Source => source !== undefined);
      const wrong = cited.filter((source) => !earlierSources.has(source.code) && !rule.fits(source, run.ticket));
      if (wrong.length > 0 || !cited.some((source) => rule.fits(source, run.ticket))) {
        const named = (wrong.length > 0 ? wrong : cited).map((source) => `${source.code} (${source.kind}, '${source.where}')`).join(', ');
        problems.push(`answer ${answer.id} on ${name} rests on ${named}, where a ${run.kind} answer rests on ${rule.what}`);
      }
    }
  }

  /**
   * A discussion keeps the member's words of its sources word for word, and in a prototype run every answer is
   * followed by one: the exchange about the prototype is how the answer was reached.
   */
  function checkDiscussions(ticket: CheckedTicket, marked: MarkedComment[], name: string): void {
    const discussions = marked.filter((comment): comment is DiscussionComment => comment.kind === 'discussion');
    for (const discussion of discussions) {
      const words = discussion.sources
        .map(sourceOf)
        .filter((source): source is Source => source !== undefined && (isChatSource(source, ticket.number) || isChunkSource(source)))
        .flatMap((source) => source.text.split('\n'))
        .filter((line) => line.trim() !== '');
      if (!words.every((line) => discussion.transcript.includes(line.trim()))) {
        problems.push(`discussion ${discussion.id} on ${name} does not keep the member's words of its source word for word`);
      }
    }
    if (run.kind !== 'prototype') {
      return;
    }
    marked.forEach((comment, index) => {
      const next = marked[index + 1];
      if (comment.kind === 'answer' && (next?.kind !== 'discussion' || next.question !== comment.question)) {
        problems.push(`answer ${comment.id} on ${name} has no discussion after it holding the exchange about the prototype`);
      }
    });
  }

  return { problems, closed, prdDue: closed.length > 0 && after.mapDone };
}
