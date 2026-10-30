/**
 * The bookkeeping rules of the map's settled and out-of-scope lists (docs/store-layout.md, "The map issue"), shared
 * by every store: one settled line per ticket, holding its latest gist, and a ticket under Out of scope is never
 * under Settled.
 */
import type { ProjectMap } from './types';

type MapLines = Pick<ProjectMap, 'settled' | 'outOfScope'>;

/** `#<number>` as a word of its own, so `#2` is not found in `#21`, `#2a`, `##2` or `issue#2`. */
const namesTicket = (line: string, ticket: number): boolean => new RegExp(`(?<![\\w#])#${ticket}(?!\\w)`).test(line);

const isOutOfScope = (map: MapLines, ticket: number): boolean => map.outOfScope.some((line) => namesTicket(line, ticket));

const hasSettledLine = (map: MapLines, ticket: number): boolean => map.settled.some((line) => line.ticket === ticket);

function withoutSettledLine<T extends MapLines>(map: T, ticket: number): T {
  return { ...map, settled: map.settled.filter((line) => line.ticket !== ticket) };
}

/** The ticket's one settled line: in the place of its first line, or last when it has none; none out of scope. */
export function withSettledLine<T extends MapLines>(map: T, ticket: number, gist: string): T {
  if (isOutOfScope(map, ticket)) {
    return withoutSettledLine(map, ticket);
  }
  const at = map.settled.findIndex((line) => line.ticket === ticket);
  const others = withoutSettledLine(map, ticket).settled;
  const place = at < 0 ? others.length : at;
  return { ...map, settled: [...others.slice(0, place), { ticket, gist }, ...others.slice(place)] };
}

/** The map once the ticket closes; `gist` is that of its latest decision, if it has one. */
export function withClosedTicket<T extends MapLines>(map: T, ticket: number, gist: string | undefined): T {
  if (isOutOfScope(map, ticket)) {
    return withoutSettledLine(map, ticket);
  }
  return gist === undefined ? map : withSettledLine(map, ticket, gist);
}

/**
 * The map once the ticket's latest decision changes; `gist` is the latest one now, if any is left. A ticket with no
 * line (reopened, not closed again) gets none here: its next close writes it.
 */
export function withLatestGist<T extends MapLines>(map: T, ticket: number, gist: string | undefined): T {
  if (!hasSettledLine(map, ticket)) {
    return map;
  }
  return gist === undefined ? withoutSettledLine(map, ticket) : withSettledLine(map, ticket, gist);
}

/** Undoes a close: the ticket leaves Settled and Out of scope, so a later decision settles it. */
export function withReopenedTicket<T extends MapLines>(map: T, ticket: number): T {
  return { ...withoutSettledLine(map, ticket), outOfScope: map.outOfScope.filter((line) => !namesTicket(line, ticket)) };
}
