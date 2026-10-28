/**
 * Nudges on tickets taken but silent for days (PRD section 4.4 item 4, release 2): when Grillo opens and once a day
 * after that, it lists the member's open tickets (taken or sent to them) that have had no answer for a number of
 * days, and raises one system notification naming them. No screen.
 */
import type { Settings } from '../../app/settings';
import { sameLogin } from '../../store/github/repo/names';
import type { Store } from '../../store/store';
import type { Ticket } from '../../store/types';

/** The settings-file key of how many days a taken ticket may stay silent, and its value until the member sets one. */
export const NUDGE_AFTER_DAYS_SETTING = 'nudgeAfterDays';
export const DEFAULT_NUDGE_AFTER_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
/** How often Grillo looks again while it stays open. */
export const NUDGE_INTERVAL_MS = DAY_MS;

/**
 * The store does not say when a ticket was taken, so Grillo notes, per ticket, the first moment it saw the member
 * holding it (`{ "<login> <project>#<number>": "<ISO 8601>" }`). A ticket the member no longer holds loses its note,
 * so taking it again starts the count afresh.
 */
export const NUDGE_HELD_SINCE_SETTING = 'nudgeHeldSince';

export const NUDGE_TITLE = 'Tickets waiting for your answer';

/** The store calls a nudge makes. */
export type NudgeStore = Pick<Store, 'listRecentProjects' | 'getProject' | 'currentMember' | 'listTickets' | 'listAnswers'>;

export interface Notice {
  title: string;
  body: string;
}

/** The operating system's notifications; a fake stands in for it in tests. */
export interface Notifier {
  show(notice: Notice): void;
}

export interface NudgeLog {
  warn(message: string): void;
}

export interface NudgesFeatureOptions {
  store: NudgeStore;
  settings: Settings;
  notifier: Notifier;
  now?: () => Date;
  log?: NudgeLog;
}

export interface NudgesFeature {
  /** Looks once: one notification when any ticket is silent, none otherwise. */
  check(): Promise<void>;
  /** Checks now, then once a day. */
  start(): void;
  stop(): void;
}

type HeldSince = Record<string, string>;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nudgeAfterDays(settings: Settings, log: NudgeLog): number {
  const value = settings.get<unknown>(NUDGE_AFTER_DAYS_SETTING, DEFAULT_NUDGE_AFTER_DAYS);
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  log.warn(
    `${NUDGE_AFTER_DAYS_SETTING} must be a number of days above 0, got '${String(value)}'; using ${DEFAULT_NUDGE_AFTER_DAYS}`,
  );
  return DEFAULT_NUDGE_AFTER_DAYS;
}

function heldSinceIn(settings: Settings): HeldSince {
  const value = settings.get<unknown>(NUDGE_HELD_SINCE_SETTING, {});
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !Number.isNaN(Date.parse(entry[1])),
    ),
  );
}

function heldKey(login: string, ticket: Ticket): string {
  return `${login.toLowerCase()} ${ticket.id.project}#${ticket.id.number}`;
}

/** The latest moment among these; dates that do not parse are left out. */
function latest(dates: string[]): number {
  return Math.max(...dates.map((date) => Date.parse(date)).filter((time) => !Number.isNaN(time)));
}

function bodyNaming(tickets: Ticket[], days: number): string {
  const lines = tickets.map((ticket) => `#${ticket.id.number} ${ticket.title} (${ticket.id.project})`);
  const unit = days === 1 ? 'day' : 'days';
  return [`No answer for ${days} ${unit} or more:`, ...lines].join('\n');
}

export function createNudgesFeature(options: NudgesFeatureOptions): NudgesFeature {
  const { store, settings, notifier, now = () => new Date(), log = console } = options;
  let timer: ReturnType<typeof setInterval> | null = null;
  let checking = false;

  /** The project's silent tickets; their held-since notes go into `held`. */
  const silentIn = async (project: string, since: HeldSince, held: HeldSince, cutoff: number): Promise<Ticket[]> => {
    const { login } = await store.currentMember(project);
    const mine = (await store.listTickets(project, { state: 'open' })).filter(
      (ticket) => ticket.assignee !== null && sameLogin(ticket.assignee, login),
    );
    const silent: Ticket[] = [];
    for (const ticket of mine) {
      const key = heldKey(login, ticket);
      held[key] = since[key] ?? now().toISOString();
      const answers = await store.listAnswers(ticket.id);
      if (latest([held[key], ...answers.map((entry) => entry.when)]) <= cutoff) {
        silent.push(ticket);
      }
    }
    return silent;
  };

  const look = async (): Promise<void> => {
    const days = nudgeAfterDays(settings, log);
    const cutoff = now().getTime() - days * DAY_MS;
    const since = heldSinceIn(settings);
    const held: HeldSince = {};
    const silent: Ticket[] = [];
    for (const { project } of await store.listRecentProjects()) {
      try {
        if (!(await store.getProject(project)).archived) {
          silent.push(...(await silentIn(project, since, held, cutoff)));
        }
      } catch (error) {
        log.warn(`Nudges could not read ${project}: ${describe(error)}`);
        // Keep this project's notes until it can be read again.
        const prefix = ` ${project}#`;
        Object.entries(since)
          .filter(([key]) => key.includes(prefix))
          .forEach(([key, value]) => (held[key] = value));
      }
    }
    settings.set(NUDGE_HELD_SINCE_SETTING, held);
    if (silent.length > 0) {
      notifier.show({ title: NUDGE_TITLE, body: bodyNaming(silent, days) });
    }
  };

  const feature: NudgesFeature = {
    async check() {
      if (checking) {
        return;
      }
      checking = true;
      try {
        await look();
      } catch (error) {
        log.warn(`Nudges check failed: ${describe(error)}`);
      } finally {
        checking = false;
      }
    },
    start() {
      void feature.check();
      timer ??= setInterval(() => void feature.check(), NUDGE_INTERVAL_MS);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
  return feature;
}
