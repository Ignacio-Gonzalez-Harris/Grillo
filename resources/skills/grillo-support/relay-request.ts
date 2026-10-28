/**
 * Reads the relay requests a support agent writes into its chat (PRD section 4.6 item 7). The support agent tab hands
 * each one it reads to the agent chat protocol's `relay`, which posts the message into the named tab's chat behind the
 * mark `[from Support, for <member>]`. A request is a fenced block at the start of a line:
 *
 * ```grillo-relay
 * to: <tab name, as the tab bar shows it>
 *
 * <the message, one or more lines>
 * ```
 *
 * The text is model output, so every other shape is refused with a reason the tab can type back, never an exception.
 */

/** The fenced block's info string. */
export const RELAY_FENCE = 'grillo-relay';
/** How the relay's mark starts; Grillo adds it, so a message that writes it itself is refused. */
export const RELAY_MARK_START = '[from Support, for ';

export type RelayRequest = { ok: true; to: string; text: string } | { ok: false; reason: string };

const TO_KEYWORD = 'to:';
/** A fence line of CommonMark: three or more backticks or tildes at the start of the line, then the info string. */
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;
/** The mark in any spelling a model might fake: any case, any spacing. */
const MARK = /\[\s*from\s+support\s*,\s*for\b/i;
const WHITESPACE_RUN = /\s+/g;

const refused = (reason: string): RelayRequest => ({ ok: false, reason });

/** Whether a line closes the fence it opened: the same character, at least as many, nothing else. */
function closes(line: string, fence: string): boolean {
  const trimmed = line.trimEnd();
  return trimmed.length >= fence.length && [...trimmed].every((character) => character === fence[0]);
}

/** One request from the lines between its fences. */
function requestOf(lines: string[]): RelayRequest {
  const blank = lines.findIndex((line) => line.trim() === '');
  const header = blank === -1 ? lines : lines.slice(0, blank);
  const message = (blank === -1 ? [] : lines.slice(blank + 1)).join('\n').trim();
  if (header.length === 0 || !header[0].startsWith(TO_KEYWORD)) {
    return refused('A relay request starts with its to: line naming the agent tab to post into');
  }
  if (header.length > 1) {
    return refused('A relay request holds one header line, to:, then an empty line, then the message');
  }
  const to = header[0].slice(TO_KEYWORD.length).replace(WHITESPACE_RUN, ' ').trim();
  if (to === '') {
    return refused('The to: line names no agent tab');
  }
  if (message === '') {
    return refused('A relay request holds no message');
  }
  if (MARK.test(message)) {
    return refused('The message writes the mark [from Support, for …] itself; Grillo adds the mark, so leave it out');
  }
  return { ok: true, to, text: message };
}

/** Every relay request in one support agent message, in order; text that is not a message holds none. */
export function readRelayRequests(message: unknown): RelayRequest[] {
  if (typeof message !== 'string') {
    return [];
  }
  const lines = message.replace(/\r\n?/g, '\n').split('\n');
  const requests: RelayRequest[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const open = FENCE_OPEN.exec(lines[index]);
    if (open === null) {
      continue;
    }
    const [, fence, info] = open;
    const end = lines.findIndex((line, at) => at > index && closes(line, fence));
    if (info.trim() === RELAY_FENCE) {
      requests.push(end === -1 ? refused('A relay request block is not closed with ``` on a line of its own') : requestOf(lines.slice(index + 1, end)));
    }
    if (end === -1) {
      break;
    }
    index = end;
  }
  return requests;
}
