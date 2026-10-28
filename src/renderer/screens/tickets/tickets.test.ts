// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentChannels } from '../../../main/features/agents/channels';
import { FakePty } from '../../../main/features/agents/fake-pty';
import { WAITING_AFTER_MS } from '../../../main/features/agents/runtime';
import { registerStoreIpc } from '../../../main/features/store/ipc';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { createMemoryStore, type MemoryStore } from '../../../main/store/memory';
import { createMemorySettings } from '../../../main/store/memory/settings';
import type { NewTicket, Store } from '../../../main/store/store';
import type { Answer, Member, Ticket } from '../../../main/store/types';
import { createGrilloApi } from '../../../preload/bridge';
import type { StartAgentRequest } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import { StoreError } from '../../../shared/store';
import { registerScreens, type ScreenModule, type ScreenParams } from '../../app/screens';
import { createShell, type Shell } from '../../app/shell';
import { PICKUP_COMMAND, PICKUP_TITLE, PRD_COMMAND, PRD_WRITER_TITLE } from './agents';
import * as ticketsScreen from './index';
import { answerLine, groupTickets, NO_DOMAIN, readTicketDetail, readTicketsView, withoutTag, withTag } from './tickets-data';

// Made-up projects, members, tickets, comments and sources only.
const NOW = new Date('2026-10-22T10:00:00.000Z');
const FOLDER = '/memory/Grillo/example-org/sample-project-1';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(): Promise<void> {
  for (let round = 0; round < 8; round += 1) await flush();
}

function ticketInput(title: string, extra: Partial<NewTicket> = {}): NewTicket {
  return {
    title,
    question: `A made-up question for ${title}?`,
    whyItMatters: 'Sample section: a made-up reason.',
    assumptions: [],
    kind: 'grilling',
    blockers: [],
    questions: [`Sample question 1 of ${title}.`, `Sample question 2 of ${title}.`],
    ...extra,
  };
}

interface Setup {
  /** No fog line on the map, so closing the last open ticket is map done. */
  noFog?: boolean;
}

/**
 * The app as it runs, in process: the real agent channels (Claude Code played by fake terminals) and the in-memory
 * store behind the real store IPC, the shell, this screen and a stand-in own-time screen that records how it opened.
 */
async function app(setup: Setup = {}) {
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const ptys: FakePty[] = [];
  registerAgentChannels(ipc, {
    findClaude: () => '/opt/made-up/bin/claude',
    shipSkills: async () => undefined,
    spawnPty: (file, args, spawnOptions) => {
      const pty = new FakePty(file, args, spawnOptions);
      ptys.push(pty);
      return pty;
    },
    env: {},
  });
  const store: MemoryStore = createMemoryStore({ now: () => NOW });
  registerStoreIpc(ipc, store, createMemorySettings());

  const bridge = createGrilloApi(fake.renderer);
  const starts: StartAgentRequest[] = [];
  const grillo: GrilloApi = {
    invoke: ((channel: string, payload: unknown) => {
      if (channel === 'agents:start') starts.push(payload as StartAgentRequest);
      return (bridge.invoke as (c: string, p: unknown) => Promise<unknown>)(channel, payload);
    }) as GrilloApi['invoke'],
    on: bridge.on,
  };

  const { id: project } = await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } });
  await store.updateMember(project, 'ada-example', { role: 'developer', domains: ['developer'] });
  await store.addMember(project, { login: 'ben-example', role: 'product', domains: ['product', 'platform'] });
  await store.createMap(project, {
    destination: 'A PRD for Sample project 1.',
    notes: '',
    fog: setup.noFog ? [] : ['Problem: sample fog item 1, cannot be asked precisely yet.'],
    outOfScope: [],
  });

  const ownTimeOpens: ScreenParams[] = [];
  const ownTime: ScreenModule = {
    id: 'own-time',
    title: 'Own-time answering',
    mount: (el, params) => {
      ownTimeOpens.push(params);
      el.textContent = 'Own-time stand-in';
    },
  };

  const root = document.createElement('div');
  document.body.append(root);
  shell = createShell(root, {
    grillo,
    screens: registerScreens({
      '/src/renderer/screens/tickets/index.ts': ticketsScreen as ScreenModule,
      '/src/renderer/screens/own-time/index.ts': ownTime,
    }),
  });

  const content = () => root.querySelector('main') as HTMLElement;
  return {
    store,
    project,
    grillo,
    starts,
    ptys,
    ownTimeOpens,
    content,
    async open(params: Record<string, string> = { project }) {
      shell?.navigate('tickets', params);
      await settle();
    },
  };
}

let shell: Shell | undefined;

afterEach(() => {
  shell?.dispose();
  shell = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
});

const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? '';
const texts = (els: Iterable<Element>) => [...els].map(text);
const buttonNamed = (scope: Element, label: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => text(candidate) === label);
async function click(scope: Element, label: string): Promise<void> {
  const target = buttonNamed(scope, label);
  if (!target) throw new Error(`No button '${label}' in: ${scope.textContent}`);
  if (target.disabled) throw new Error(`Button '${label}' is disabled`);
  target.click();
  await settle();
}
const picker = (scope: Element, label: string) => scope.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
async function pick(scope: Element, label: string, value: string): Promise<void> {
  const select = picker(scope, label);
  if (!select) throw new Error(`No picker '${label}'`);
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await settle();
}
function fill(scope: Element, label: string, value: string): void {
  const field = [...scope.querySelectorAll('label.field')].find((candidate) => candidate.firstChild?.textContent === label);
  const input = field?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
  if (!input) throw new Error(`No field '${label}'`);
  input.value = value;
}

const listCard = (content: HTMLElement) => content.querySelector('.tickets-screen .split > .card:first-child') as HTMLElement;
const detailCard = (content: HTMLElement) => content.querySelector('.tickets-screen .split > .card:last-child') as HTMLElement;
/** The list's groups as `heading: title, title`. */
function groups(content: HTMLElement): string[] {
  return [...listCard(content).querySelectorAll('.list-head')].map(
    (head) => `${text(head)}: ${texts(head.nextElementSibling?.querySelectorAll('button.pick') ?? []).join(', ')}`,
  );
}
async function openTicket(content: HTMLElement, title: string): Promise<void> {
  const row = [...listCard(content).querySelectorAll<HTMLButtonElement>('button.pick')].find((candidate) => text(candidate).startsWith(title));
  if (!row) throw new Error(`No ticket '${title}' in the list`);
  row.click();
  await settle();
}
const heading = (content: HTMLElement) => texts(detailCard(content).querySelector('.row')?.children ?? []);
const questionRows = (content: HTMLElement) => [...detailCard(content).querySelectorAll<HTMLElement>('ul.rows > li')];
const tagsOf = (content: HTMLElement) =>
  [...detailCard(content).querySelectorAll('.row .tag')].map((tag) => `${tag.className}:${tag.firstChild?.textContent ?? ''}`);
const theDialog = (content: HTMLElement) => content.querySelector('[role="dialog"]') as HTMLElement;

/** Lets a running agent print, then go quiet: the tab's waiting dot. */
async function agentGoesQuiet(pty: FakePty): Promise<void> {
  pty.print('Sample agent output.\r\n');
  await vi.advanceTimersByTimeAsync(WAITING_AFTER_MS);
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  await settle();
}

/** Ada (developer) and Ben (product, platform): one ticket for each group of Ada's list, and one closed. */
async function ownList(store: Store, project: string): Promise<Record<string, Ticket>> {
  const taken = await store.createTicket(project, ticketInput('Sample ticket 1'));
  const mine = await store.createTicket(project, ticketInput('Sample ticket 2'));
  const anyone = await store.createTicket(project, ticketInput('Sample ticket 3'));
  const product = await store.createTicket(project, ticketInput('Sample ticket 4'));
  const held = await store.createTicket(project, ticketInput('Sample ticket 5'));
  const untagged = await store.createTicket(project, ticketInput('Sample ticket 6'));
  const closed = await store.createTicket(project, ticketInput('Sample ticket 7'));
  await store.updateTicket(taken.id, { domains: ['product'] });
  await store.claimTicket(taken.id);
  await store.updateTicket(mine.id, { domains: ['developer'] });
  await store.updateTicket(anyone.id, { noDomain: true });
  await store.updateTicket(product.id, { domains: ['product'] });
  await store.updateTicket(held.id, { domains: ['developer'] });
  await store.sendTicket(held.id, 'ben-example');
  await store.closeTicket(closed.id);
  return { taken, mine, anyone, product, held, untagged, closed };
}

describe('the tickets screen: the own list', () => {
  it('says there are no tickets yet while the engine has built none (the "Empty list" state)', async () => {
    const { content, open } = await app();
    await open();

    expect(text(content().querySelector('.tickets-screen .card'))).toBe('No tickets yet. They appear here once the grilling agent has built the map.');
    expect(content().querySelector('.split')).toBeNull();
  });

  it('lists my tickets first, then my domains and "no domain", then everything else with who holds it, then the closed ones', async () => {
    const { store, project, content, open } = await app();
    await ownList(store, project);
    await open();

    expect(groups(content())).toEqual([
      'Taken by you or sent to you: Sample ticket 1',
      'Your domains: Sample ticket 2, Sample ticket 3',
      'Everything else: Sample ticket 4, Sample ticket 5 · ben-example, Sample ticket 6',
      'Closed: Sample ticket 7',
    ]);
    expect(heading(content())[0]).toBe('Sample ticket 1');
    expect(listCard(content()).querySelector('li.selected button.pick')?.getAttribute('aria-current')).toBe('true');
  });

  it('search keeps the tickets whose title or questions match, and says when none does', async () => {
    const { store, project, content, open } = await app();
    await ownList(store, project);
    await open();

    const search = listCard(content()).querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
    search.value = 'question 2 of sample ticket 4';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(groups(content())).toEqual(['Everything else: Sample ticket 4']);

    const again = listCard(content()).querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
    again.value = 'nothing like this';
    again.dispatchEvent(new Event('input'));
    await settle();
    expect(groups(content())).toEqual([]);
    expect(text(listCard(content()).querySelector('p.muted'))).toBe('No ticket matches your search.');
  });

  it('opens the ticket it was opened with', async () => {
    const { store, project, content, open } = await app();
    const tickets = await ownList(store, project);
    await open({ project, ticket: String(tickets.product.id.number) });

    expect(heading(content())[0]).toBe('Sample ticket 4');
  });
});

describe('the tickets screen: an unassigned ticket', () => {
  it('shows its kind, "Not assigned", its tags, Take, Send, Edit, Merge, Close as out of scope and its open questions', async () => {
    const { store, project, content, open } = await app();
    const tickets = await ownList(store, project);
    await open({ project, ticket: String(tickets.mine.id.number) });

    expect(heading(content())).toEqual(['Sample ticket 2', 'grilling', 'Not assigned']);
    expect(tagsOf(content())).toEqual(['tag d1:developer']);
    for (const label of ['Take', 'Send', 'Edit', 'Merge', 'Close as out of scope', 'Answer now']) {
      expect(buttonNamed(detailCard(content()), label), label).toBeDefined();
    }
    expect(texts(questionRows(content()))).toEqual([
      `Q${tickets.mine.id.number}.1: Sample question 1 of Sample ticket 2.Open`,
      `Q${tickets.mine.id.number}.2: Sample question 2 of Sample ticket 2.Open`,
    ]);
  });

  it('Take claims it under my name and moves it to my list; Release puts it back in the pool, unlocked', async () => {
    const { store, project, content, open } = await app();
    const tickets = await ownList(store, project);
    await open({ project, ticket: String(tickets.mine.id.number) });

    await click(detailCard(content()), 'Take');
    expect((await store.getTicket(tickets.mine.id)).assignee).toBe('ada-example');
    expect(groups(content())[0]).toBe('Taken by you or sent to you: Sample ticket 1, Sample ticket 2');
    expect(heading(content())[2]).toBe('Assigned to you');

    await click(detailCard(content()), 'Release');
    expect((await store.getTicket(tickets.mine.id)).assignee).toBeNull();
    expect(heading(content())[2]).toBe('Not assigned');
  });

  it('Send stays off until a member is picked, then sends it to that member, who now holds it locked', async () => {
    const { store, project, content, open } = await app();
    const tickets = await ownList(store, project);
    await open({ project, ticket: String(tickets.mine.id.number) });

    expect(texts(picker(detailCard(content()), 'Send to')?.options ?? [])).toEqual(['Send to…', 'ben-example']);
    expect(buttonNamed(detailCard(content()), 'Send')?.disabled).toBe(true);
    await pick(detailCard(content()), 'Send to', 'ben-example');
    await click(detailCard(content()), 'Send');

    expect((await store.getTicket(tickets.mine.id)).assignee).toBe('ben-example');
    expect(heading(content())[2]).toBe('Locked · assigned to ben-example');
  });

  it('a Take that loses the claim to another laptop shows the refusal and the ticket locked to whoever won', async () => {
    const { store, project, content, open } = await app();
    const tickets = await ownList(store, project);
    await open({ project, ticket: String(tickets.mine.id.number) });

    await store.sendTicket(tickets.mine.id, 'ben-example');
    await click(detailCard(content()), 'Take');

    expect(text(content().querySelector('.note.err'))).toContain('already taken by ben-example');
    expect(heading(content())[2]).toBe('Locked · assigned to ben-example');
    expect((await store.getTicket(tickets.mine.id)).assignee).toBe('ben-example');
  });

  it('Answer now opens the own-time screen on this ticket', async () => {
    const { store, project, content, open, ownTimeOpens } = await app();
    const tickets = await ownList(store, project);
    await open({ project, ticket: String(tickets.mine.id.number) });

    await click(detailCard(content()), 'Answer now');
    expect(ownTimeOpens).toEqual([{ project, ticket: String(tickets.mine.id.number) }]);
  });
});

describe('the tickets screen: locked by another member', () => {
  it('greys out Take with who holds it, keeps the questions readable, and Reassign moves the unanswered ticket', async () => {
    const { store, project, content, open } = await app();
    const tickets = await ownList(store, project);
    await open({ project, ticket: String(tickets.held.id.number) });

    expect(heading(content())).toEqual(['Sample ticket 5', 'grilling', 'Locked · assigned to ben-example']);
    expect(buttonNamed(detailCard(content()), 'Take')?.disabled).toBe(true);
    expect(text(detailCard(content()).querySelector('.reason'))).toBe('Assigned to ben-example. You can still read and discuss it.');
    expect(buttonNamed(detailCard(content()), 'Merge')).toBeUndefined();
    expect(questionRows(content())).toHaveLength(2);
    expect(texts(picker(detailCard(content()), 'Reassign to')?.options ?? [])).toEqual(['Reassign to…', 'ada-example (you)']);

    await pick(detailCard(content()), 'Reassign to', 'ada-example');
    await click(detailCard(content()), 'Reassign');
    expect((await store.getTicket(tickets.held.id)).assignee).toBe('ada-example');
    expect(heading(content())[2]).toBe('Assigned to you');
  });

  it('offers no Reassign once the ticket has an answer, and says why', async () => {
    const { store, project, content, open } = await app();
    const tickets = await ownList(store, project);
    await store.createAnswer(tickets.held.id, {
      question: `Q${tickets.held.id.number}.1`,
      text: 'Sample answer text.',
      sources: [],
      via: null,
      fromComment: null,
    });
    await open({ project, ticket: String(tickets.held.id.number) });

    expect(picker(detailCard(content()), 'Reassign to')).toBeNull();
    expect(text(detailCard(content()))).toContain('It has an answer already, so it can no longer be reassigned.');
  });
});

describe('the tickets screen: tags changed by hand', () => {
  it('adds a declared domain, removes one with its ×, and "no domain" replaces every domain', async () => {
    const { store, project, content, open } = await app();
    const tickets = await ownList(store, project);
    await open({ project, ticket: String(tickets.mine.id.number) });

    expect(texts(picker(detailCard(content()), 'Add a domain tag')?.options ?? [])).toEqual([
      'Add a domain…',
      'product',
      'platform',
      NO_DOMAIN,
    ]);
    await pick(detailCard(content()), 'Add a domain tag', 'platform');
    expect((await store.getTicket(tickets.mine.id)).domains).toEqual(['developer', 'platform']);
    expect(tagsOf(content())).toEqual(['tag d1:developer', 'tag d3:platform']);

    await click(detailCard(content()), '×');
    expect((await store.getTicket(tickets.mine.id)).domains).toEqual(['platform']);

    await pick(detailCard(content()), 'Add a domain tag', NO_DOMAIN);
    const ticket = await store.getTicket(tickets.mine.id);
    expect([ticket.domains, ticket.noDomain]).toEqual([[], true]);
    expect(tagsOf(content())).toEqual(['tag none:no domain']);
    // The ticket now sits in my list as open to anyone.
    expect(groups(content())[1]).toBe('Your domains: Sample ticket 2, Sample ticket 3');
  });
});

describe('the tickets screen: answers from GitHub comments', () => {
  async function answeredFromGithub() {
    const setup = await app();
    const { store, project } = setup;
    const ticket = await store.createTicket(project, ticketInput('Sample ticket 1', { questions: ['Sample question 1.1.', 'Sample question 1.2.'] }));
    await store.sendTicket(ticket.id, 'ben-example');
    const comment = store.addMemberComment(ticket.id, 'ben-example', 'Sample answer text from GitHub.');
    const source = await store.createSource(project, {
      kind: 'pasted-text',
      who: 'ben-example',
      when: '2026-10-21T08:00:00.000Z',
      where: `GitHub comment on ticket #${ticket.id.number}`,
      text: 'Sample answer text from GitHub.',
    });
    const answer = await store.createAnswer(ticket.id, {
      question: `Q${ticket.id.number}.1`,
      text: 'Sample answer text from GitHub.',
      sources: [source.code],
      via: 'github',
      fromComment: comment.id,
    });
    return { ...setup, ticket, answer, source };
  }

  it('shows the answer with its source "member, via GitHub, date", who recorded it, the source code and Undo', async () => {
    const { project, content, open, ticket, source } = await answeredFromGithub();
    await open({ project, ticket: String(ticket.id.number) });

    const [answered, unanswered] = questionRows(content());
    expect(text(answered.querySelector('p'))).toBe(
      `Answer: Sample answer text from GitHub. Source: ben-example, via GitHub, 2026-10-21 · recorded by ada-example ${source.code}`,
    );
    expect(texts(answered.querySelectorAll('.badge, button'))).toEqual(['Answered', 'Undo']);
    expect(texts(unanswered.querySelectorAll('.badge'))).toEqual(['Open']);
    expect(text(detailCard(content()))).toContain('Recorded from GitHub comments by ada-example. Any member can undo it.');
  });

  it('Undo deletes the recorded answer and the question is open again', async () => {
    const { store, project, content, open, ticket } = await answeredFromGithub();
    await open({ project, ticket: String(ticket.id.number) });

    await click(questionRows(content())[0], 'Undo');
    expect(await store.listAnswers(ticket.id)).toEqual([]);
    expect(texts(questionRows(content())[0].querySelectorAll('.badge'))).toEqual(['Open']);
  });

  it('a closed ticket with every question answered says so, keeps Undo, and offers no claim controls', async () => {
    const { store, project, content, open, ticket } = await answeredFromGithub();
    await store.createAnswer(ticket.id, { question: `Q${ticket.id.number}.2`, text: 'Typed answer.', sources: [], via: null, fromComment: null });
    await store.closeTicket(ticket.id);
    await open({ project, ticket: String(ticket.id.number) });

    expect(heading(content())).toEqual(['Sample ticket 1', 'grilling', 'Closed · all questions answered']);
    // A closed ticket names no holder in the list: it is no longer anyone's to answer.
    expect(groups(content())).toEqual(['Closed: Sample ticket 1']);
    expect(text(questionRows(content())[1].querySelector('p'))).toBe('Answer: Typed answer. Recorded by ada-example, 2026-10-22');
    expect(buttonNamed(detailCard(content()), 'Take')).toBeUndefined();
    expect(picker(detailCard(content()), 'Add a domain tag')).toBeNull();
    expect(buttonNamed(detailCard(content()), 'Answer now')).toBeUndefined();
    expect(texts(detailCard(content()).querySelectorAll('button')).filter((label) => label === 'Undo')).toHaveLength(2);
  });

  it('"Pick up GitHub comments" shows only while comments wait, starts /grillo-answer pickup, then offers its tab', async () => {
    const { store, project, starts, content, open } = await app();
    const ticket = await store.createTicket(project, ticketInput('Sample ticket 1'));
    await open();
    expect(buttonNamed(content(), 'Pick up GitHub comments')).toBeUndefined();

    store.addMemberComment(ticket.id, 'ben-example', 'Sample answer one.');
    store.addMemberComment(ticket.id, 'ben-example', 'Sample answer two.');
    await open();
    expect(text(content().querySelector('.note'))).toContain('2 comments written in GitHub wait to be recorded as answers.');
    await click(content(), 'Pick up GitHub comments');

    expect(starts).toEqual([{ kind: 'grilling', folder: FOLDER, firstMessage: PICKUP_COMMAND, title: PICKUP_TITLE }]);
    expect(PICKUP_COMMAND).toBe('/grillo-answer pickup');
    expect(text(content().querySelector('.note'))).toContain('The comment pickup runs in its own tab.');
    expect(buttonNamed(content(), 'Open the comment pickup')).toBeDefined();
  });

  it('reads the store again when the pickup agent goes quiet, so the answers it recorded appear', async () => {
    const { store, project, ptys, content, open } = await app();
    const ticket = await store.createTicket(project, ticketInput('Sample ticket 1'));
    const comment = store.addMemberComment(ticket.id, 'ben-example', 'Sample answer one.');
    await open();
    await click(content(), 'Pick up GitHub comments');

    vi.useFakeTimers();
    await store.createAnswer(ticket.id, { question: `Q${ticket.id.number}.1`, text: 'Sample answer one.', sources: [], via: 'github', fromComment: comment.id });
    await agentGoesQuiet(ptys[0]);

    expect(texts(questionRows(content())[0].querySelectorAll('.badge'))).toEqual(['Answered']);
  });
});

describe('the tickets screen: discussion, edit, merge and close as out of scope', () => {
  it('Show discussion shows each discussion word for word, with who recorded it', async () => {
    const { store, project, content, open } = await app();
    const ticket = await store.createTicket(project, ticketInput('Sample ticket 1'));
    await store.createDiscussion(ticket.id, {
      question: `Q${ticket.id.number}.1`,
      transcript: 'Sample speaker A: a made-up line.\nSample speaker B: another made-up line.',
      sessionFile: null,
      sources: [],
      via: null,
    });
    await open();

    await click(detailCard(content()), 'Show discussion (word for word)');
    expect(text(detailCard(content()).querySelector('.transcript'))).toBe(
      'Sample speaker A: a made-up line.Sample speaker B: another made-up line.',
    );
    expect(text(detailCard(content()))).toContain(`Q${ticket.id.number}.1 · recorded by ada-example, 2026-10-22`);
    await click(detailCard(content()), 'Hide discussion');
    expect(detailCard(content()).querySelector('.transcript')).toBeNull();
  });

  it('Edit changes the title, kind, question and why it matters', async () => {
    const { store, project, content, open } = await app();
    const ticket = await store.createTicket(project, ticketInput('Sample ticket 1'));
    await open();

    await click(detailCard(content()), 'Edit');
    fill(theDialog(content()), 'Title', 'Sample ticket 1, renamed');
    fill(theDialog(content()), 'Kind', 'research');
    await click(theDialog(content()), 'Save');

    const saved = await store.getTicket(ticket.id);
    expect([saved.title, saved.kind]).toEqual(['Sample ticket 1, renamed', 'research']);
    expect(heading(content()).slice(0, 2)).toEqual(['Sample ticket 1, renamed', 'research']);
  });

  it('Merge closes the ticket as a duplicate of the one picked, and starts no PRD writer while fog is left', async () => {
    const { store, project, starts, content, open } = await app();
    const one = await store.createTicket(project, ticketInput('Sample ticket 1'));
    const two = await store.createTicket(project, ticketInput('Sample ticket 2'));
    await open({ project, ticket: String(one.id.number) });

    await click(detailCard(content()), 'Merge');
    fill(theDialog(content()), 'Merge into', String(two.id.number));
    await click(theDialog(content()), 'Merge');

    const merged = await store.getTicket(one.id);
    expect([merged.state, merged.duplicateOf]).toEqual(['closed', two.id.number]);
    expect(heading(content())[2]).toBe('Closed · merged into Sample ticket 2');
    expect(starts).toEqual([]);
  });

  it('a merge that completes the map starts the PRD writer with /grillo-prd and offers it and the PRD', async () => {
    const { store, project, starts, content, open } = await app({ noFog: true });
    const one = await store.createTicket(project, ticketInput('Sample ticket 1'));
    const two = await store.createTicket(project, ticketInput('Sample ticket 2'));
    await store.closeTicket(two.id);
    const three = await store.createTicket(project, ticketInput('Sample ticket 3'));
    await open({ project, ticket: String(one.id.number) });

    await click(detailCard(content()), 'Merge');
    fill(theDialog(content()), 'Merge into', String(three.id.number));
    await click(theDialog(content()), 'Merge');
    expect(starts).toEqual([]);

    await openTicket(content(), 'Sample ticket 3');
    await click(detailCard(content()), 'Close as out of scope');
    fill(theDialog(content()), 'Why it is out of scope (optional)', 'a made-up reason');
    await click(theDialog(content()), 'Close as out of scope');

    expect(starts).toEqual([{ kind: 'grilling', folder: FOLDER, firstMessage: PRD_COMMAND, title: PRD_WRITER_TITLE }]);
    expect((await store.getMap(project)).outOfScope).toEqual([`Sample ticket 3: a made-up reason (#${three.id.number})`]);
    expect(text(content().querySelector('.note.ok'))).toContain('The map is done: no open tickets and no fog. Grillo is writing the PRD now.');
    expect(buttonNamed(content(), 'Open the PRD writer')).toBeDefined();
    expect(buttonNamed(content(), 'Open the PRD')).toBeDefined();
  });
});

describe('the tickets screen: archived project and what it cannot read', () => {
  it('an archived project stays readable and offers no change: no claim, tags, Undo or pickup', async () => {
    const { store, project, content, open } = await app();
    const ticket = await store.createTicket(project, ticketInput('Sample ticket 1'));
    store.addMemberComment(ticket.id, 'ben-example', 'Sample comment.');
    await store.createAnswer(ticket.id, { question: `Q${ticket.id.number}.1`, text: 'Typed answer.', sources: [], via: null, fromComment: null });
    await store.archiveProject(project);
    await open();

    expect(text(content().querySelector('.note.warn'))).toBe('The repository is archived: everything stays readable and nothing can change.');
    expect(questionRows(content())).toHaveLength(2);
    for (const label of ['Take', 'Undo', 'Pick up GitHub comments', 'Answer now', 'Edit']) {
      expect(buttonNamed(content(), label), label).toBeUndefined();
    }
    expect(picker(detailCard(content()), 'Add a domain tag')).toBeNull();
  });

  it('says to open a project when there is none to show', async () => {
    const { content, open } = await app();
    await open({});

    expect(text(content().querySelector('.note.err'))).toBe('Open a project from the Project tab to see its tickets.');
  });
});

describe('tickets data: grouping, tags and what the store answers', () => {
  const member: Member = { login: 'Ada-Example', name: null, email: null, role: '', domains: ['developer'] };
  const base: Ticket = {
    id: { project: 'example-org/sample-project-1', number: 1 },
    title: 'Sample ticket 1',
    question: 'A made-up question?',
    whyItMatters: '',
    assumptions: [],
    kind: 'grilling',
    domains: [],
    noDomain: false,
    blockers: [],
    assignee: null,
    state: 'open',
    duplicateOf: null,
    questions: [],
  };

  it('compares logins without regard to case and never lists a held ticket under my domains', () => {
    const tickets: Ticket[] = [
      { ...base, id: { ...base.id, number: 1 }, assignee: 'ada-example' },
      { ...base, id: { ...base.id, number: 2 }, domains: ['developer'], assignee: 'ben-example' },
      { ...base, id: { ...base.id, number: 3 }, domains: [' developer '] },
    ];
    const grouped = groupTickets(tickets, member);
    expect([grouped.mine, grouped.domains, grouped.others].map((list) => list.map(({ id }) => id.number))).toEqual([[1], [3], [2]]);
  });

  it.each([
    ['adds a domain', { domains: ['developer'] }, 'product', { domains: ['developer', 'product'], noDomain: false }],
    ['adds a domain it has once', { domains: ['developer'] }, 'developer', { domains: ['developer'], noDomain: false }],
    ['replaces "no domain" with a domain', { noDomain: true }, 'product', { domains: ['product'], noDomain: false }],
    ['replaces every domain with "no domain"', { domains: ['developer', 'product'] }, NO_DOMAIN, { domains: [], noDomain: true }],
  ])('withTag %s', (_, ticket, tag, patch) => {
    expect(withTag({ ...base, ...ticket }, tag)).toEqual(patch);
  });

  it('withTag refuses an empty domain; withoutTag leaves an untagged ticket when the last tag goes', () => {
    expect(() => withTag(base, '  ')).toThrow(StoreError);
    expect(withoutTag({ ...base, domains: ['developer'] }, 'developer')).toEqual({ domains: [], noDomain: false });
    expect(withoutTag({ ...base, noDomain: true }, NO_DOMAIN)).toEqual({ domains: [], noDomain: false });
  });

  it('answerLine tells an answer whatever fields the store left out or doubled', () => {
    const broken = { id: 'c1', question: 'Q1.1', text: 'Sample.', when: '2026-10-22T10:00:00.000Z', who: null, sources: [null, 'S1', 'S1'], via: 'github' };
    expect(answerLine(broken as unknown as Answer, [])).toEqual({
      text: 'Sample.',
      viaGithub: true,
      origin: 'a member, via GitHub, 2026-10-22',
      recordedBy: 'an unknown member',
      day: '2026-10-22',
      sources: ['S1'],
    });
    expect(answerLine({ ...broken, sources: null, via: null } as unknown as Answer, []).sources).toEqual([]);
  });

  function storeAnswering(answers: { comments?: unknown; discussions?: unknown }): Store {
    const project = { id: base.id.project, name: 'sample-project-1', archived: false, members: [{ ...member, login: 'ada-example' }] };
    return {
      getProject: async () => project,
      viewerPermission: async () => 'admin',
      currentMember: async () => ({ ...member, login: 'ada-example' }),
      getMap: async () => ({ number: 9, destination: '', notes: '', settled: [], fog: [], outOfScope: [] }),
      listTickets: async () => [base, { ...base, id: { ...base.id, number: 2 }, state: 'closed' }],
      listSources: async () => [],
      listPickupComments: async () => answers.comments,
      getTicket: async () => base,
      listAnswers: async () => [],
      listDiscussions: async () => answers.discussions,
    } as unknown as Store;
  }

  it('counts each waiting comment once, on open tickets only, and refuses a comment list that is no list', async () => {
    const view = await readTicketsView(storeAnswering({ comments: [{ id: 'c1' }, { id: 'c1' }, null, { id: 'c2' }] }), base.id.project);
    expect(view.pickupComments).toBe(2);
    const refusal = readTicketsView(storeAnswering({ comments: null }), base.id.project);
    await expect(refusal).rejects.toMatchObject({ kind: 'backend' });
  });

  it('keeps each readable discussion once and refuses a discussion list that is no list', async () => {
    const good = { id: 'c3', question: 'Q1.1', transcript: 'Sample.', who: 'ada-example', when: '2026-10-22T10:00:00.000Z' };
    const detail = await readTicketDetail(storeAnswering({ discussions: [good, good, null, { ...good, id: 'c4', transcript: null }] }), base.id);
    expect(detail.discussions.map(({ id }) => id)).toEqual(['c3']);
    await expect(readTicketDetail(storeAnswering({ discussions: 'none' }), base.id)).rejects.toMatchObject({ kind: 'backend' });
  });
});
