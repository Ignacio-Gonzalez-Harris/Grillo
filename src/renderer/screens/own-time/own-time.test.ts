// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentChannels } from '../../../main/features/agents/channels';
import { FakePty } from '../../../main/features/agents/fake-pty';
import { ENTER_AFTER_QUIET_MS, WAITING_AFTER_MS } from '../../../main/features/agents/runtime';
import { registerStoreIpc } from '../../../main/features/store/ipc';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { createMemoryStore, type MemoryStore } from '../../../main/store/memory';
import { createMemorySettings } from '../../../main/store/memory/settings';
import type { Store } from '../../../main/store/store';
import type { Ticket, TicketId } from '../../../main/store/types';
import { createGrilloApi } from '../../../preload/bridge';
import type { StartAgentRequest } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import { StoreError } from '../../../shared/store';
import { registerScreens, type ScreenModule } from '../../app/screens';
import { createShell, type Shell } from '../../app/shell';
import { FakeTerminalView } from '../../components/terminal/fake-terminal-view';
import { createAgentTabs, type AgentTabs } from '../agent-tab/agent-tabs';
import { registerTabPanels } from '../agent-tab/tab-panels';
import { terminalPanel } from '../agent-tab/terminal-panel';
import * as ownTimeScreen from './index';
import ownTimeTabPanel from './tab-panel';
import { readTicketView } from './ticket';

// Made-up project, member and ticket only.
const NOW = new Date('2026-10-22T10:00:00.000Z');
const PROJECT = 'example-org/sample-project-1';
const QUESTIONS = [
  'Sample question: a made-up question for a developer.',
  'Sample question: a made-up follow-up question.',
  'Sample question: another made-up question.',
];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Claude Code has echoed what was typed and gone quiet, so the runtime has pressed Enter and the send is done. */
async function enterPressed(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ENTER_AFTER_QUIET_MS));
  await flush();
  await flush();
}

/**
 * The app as it runs, in process: the real agent channels (Claude Code played by fake terminals) and the in-memory
 * store behind the real store IPC, the shell with the agent tab (its own-time panel included) and this screen.
 */
async function app(options: { claudeMissing?: boolean } = {}) {
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const ptys: FakePty[] = [];
  registerAgentChannels(ipc, {
    findClaude: () => {
      if (options.claudeMissing) throw new Error('Claude Code is not installed on this laptop');
      return '/opt/made-up/bin/claude';
    },
    shipSkills: async () => undefined,
    spawnPty: (file, args, spawnOptions) => {
      const pty = new FakePty(file, args, spawnOptions);
      pty.echoTyping = true;
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

  await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } });
  await store.updateMember(PROJECT, 'ada-example', { role: 'developer', domains: ['developer'] });
  await store.addMember(PROJECT, { login: 'ben-example', role: 'product', domains: ['product'] });
  await store.createMap(PROJECT, { destination: 'A PRD for a sample product', notes: '', fog: [], outOfScope: [] });
  const ticket = await store.createTicket(PROJECT, {
    title: 'Sample ticket 4',
    question: 'A made-up question?',
    whyItMatters: 'Sample section: a made-up reason.',
    assumptions: [],
    kind: 'grilling',
    blockers: [],
    questions: QUESTIONS,
  });
  await store.updateTicket(ticket.id, { domains: ['developer'] });

  const views: FakeTerminalView[] = [];
  const terminal = terminalPanel(() => {
    const view = new FakeTerminalView();
    view.sizeToFit = { cols: 100, rows: 30 };
    views.push(view);
    return view;
  });
  let tabs: AgentTabs | undefined;
  const agentTabScreen: ScreenModule = {
    id: 'agent-tab',
    title: 'Agent',
    start(shellContext) {
      tabs = createAgentTabs(shellContext, registerTabPanels({}, [terminal, ownTimeTabPanel]));
      return () => tabs?.dispose();
    },
    mount: (el, params) => (tabs as AgentTabs).show(el, params['agentId'] ?? ''),
  };
  const root = document.createElement('div');
  document.body.append(root);
  shell = createShell(root, {
    grillo,
    screens: registerScreens({
      '/src/renderer/screens/agent-tab/index.ts': agentTabScreen,
      '/src/renderer/screens/own-time/index.ts': ownTimeScreen,
    }),
  });

  const content = () => root.querySelector('main') as HTMLElement;
  const code = (k: number) => `Q${ticket.id.number}.${k}`;
  return {
    store,
    grillo,
    ticket,
    starts,
    ptys,
    content,
    code,
    async open(params: Record<string, string> = { project: PROJECT, ticket: String(ticket.id.number) }) {
      shell?.navigate('own-time', params);
      await flush();
      await flush();
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
const buttonNamed = (scope: HTMLElement, label: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => text(candidate) === label);
async function click(scope: HTMLElement, label: string): Promise<void> {
  const target = buttonNamed(scope, label);
  if (!target) throw new Error(`No button '${label}' in: ${scope.textContent}`);
  target.click();
  await flush();
  await flush();
}
function typeInto(field: HTMLTextAreaElement | null, value: string): void {
  if (!field) throw new Error('No such field');
  field.value = value;
  field.dispatchEvent(new Event('input'));
}
const answerField = (content: HTMLElement, code: string) =>
  content.querySelector<HTMLTextAreaElement>(`textarea[aria-label="Answer to ${code}"]`);
const cardOf = (field: Element | null) => field?.closest<HTMLElement>('.card') as HTMLElement;
const answerFrom = (code: string, words: string) => ({ question: code, text: words, sources: [], via: null, fromComment: null });

describe('own-time answering: in a form', () => {
  it('takes a ticket in the pool and shows its heading and every question with its answered state and answer', async () => {
    const { store, ticket, content, code, open } = await app();
    await store.createAnswer(ticket.id, answerFrom(code(1), 'Sample answer text, already saved.'));

    await open();

    const heading = content().querySelector('.own-time > .row') as HTMLElement;
    expect(text(heading.querySelector('h3'))).toBe('Sample ticket 4');
    expect(texts(heading.querySelectorAll('.tag'))).toEqual(['developer']);
    expect(text(heading.querySelector('.badge.warn'))).toBe('Taken by you');
    expect(text(heading.querySelector('.seg [aria-pressed="true"]'))).toBe('In a form');
    const cards = [...content().querySelectorAll('.own-time > .card')];
    expect(cards.map((card) => text(card.querySelector('.badge')))).toEqual(['Answered', 'Open', 'Open']);
    expect(text(cards[0].querySelector('.strong'))).toBe(`${code(1)} ${QUESTIONS[0]}`);
    expect(text(cards[0].querySelector('p.small'))).toBe('Sample answer text, already saved.');
    expect(buttonNamed(cards[0] as HTMLElement, 'Edit')).toBeDefined();
    expect(answerField(content(), code(2))?.placeholder).toBe('Your answer');
    expect((await store.getTicket(ticket.id)).assignee).toBe('ada-example');
  });

  it('saves a typed answer as an own-time source with the words, then an answer citing it, and marks it answered', async () => {
    const { store, ticket, content, code, open } = await app();
    await open();
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });

    typeInto(answerField(content(), code(2)), '  Sample answer being typed.  ');
    await click(cardOf(answerField(content(), code(2))), 'Save answer');

    expect(await store.listSources(PROJECT)).toEqual([
      {
        code: 'S1',
        kind: 'own-time-answer',
        who: 'Ada Example, developer',
        when: NOW.toISOString(),
        where: `Grillo, own-time form on ticket #${ticket.id.number}`,
        text: 'Sample answer being typed.',
      },
    ]);
    expect(await store.listAnswers(ticket.id)).toMatchObject([
      { question: code(2), text: 'Sample answer being typed.', sources: ['S1'], via: null, who: 'ada-example' },
    ]);
    const cards = [...content().querySelectorAll('.own-time > .card')];
    expect(cards.map((card) => text(card.querySelector('.badge')))).toEqual(['Open', 'Answered', 'Open']);
    expect(text(cards[1].querySelector('p.small'))).toBe('Sample answer being typed.');
  });

  it('Edit saves the changed words as a new source and answer, and only then deletes the old answer', async () => {
    const { store, ticket, content, code, open } = await app();
    const old = await store.createAnswer(ticket.id, answerFrom(code(1), 'Sample first answer.'));
    await open();

    await click(content(), 'Edit');
    expect(answerField(content(), code(1))?.value).toBe('Sample first answer.');
    typeInto(answerField(content(), code(1)), 'Sample changed answer.');
    await click(content(), 'Save answer');

    const answers = await store.listAnswers(ticket.id);
    expect(answers.map(({ text: words, sources }) => ({ words, sources }))).toEqual([{ words: 'Sample changed answer.', sources: ['S1'] }]);
    expect(answers.some(({ id }) => id === old.id)).toBe(false);
    expect((await store.listSources(PROJECT)).map(({ text: words }) => words)).toEqual(['Sample changed answer.']);
    expect(text(content().querySelector('.own-time > .card p.small'))).toBe('Sample changed answer.');
  });

  it('shows why an answer was not saved and keeps the typed words', async () => {
    const { store, ticket, content, code, open } = await app();
    await open();

    typeInto(answerField(content(), code(1)), '   ');
    await click(content(), 'Save answer');

    expect(text(content().querySelector('.note.err'))).toBe('Write an answer before saving it.');
    expect(answerField(content(), code(1))?.value).toBe('   ');
    expect(await store.listAnswers(ticket.id)).toEqual([]);
  });

  it('Done with open questions returns the ticket to the pool, unlocked, and lists what is still open', async () => {
    const { store, ticket, content, code, open } = await app();
    await store.createAnswer(ticket.id, answerFrom(code(1), 'Sample answer.'));
    await store.createAnswer(ticket.id, answerFrom(code(2), 'Sample answer.'));
    await open();

    await click(content(), 'Done');

    const after = await store.getTicket(ticket.id);
    expect({ state: after.state, assignee: after.assignee }).toEqual({ state: 'open', assignee: null });
    expect(text(content().querySelector('.note.warn'))).toBe(
      'Sample ticket 4 is back in the pool, unlocked. 1 question is still open and visible to everyone.',
    );
    expect(texts(content().querySelectorAll('.rows .badge'))).toEqual(['Answered', 'Answered', 'Open']);
  });

  it.each([
    { otherTicketOpen: false, prdWriterStarted: true },
    { otherTicketOpen: true, prdWriterStarted: false },
  ])(
    'Done with every question answered closes the ticket; the PRD writer starts only on a mapDone result (%o)',
    async ({ otherTicketOpen, prdWriterStarted }) => {
      const { store, ticket, starts, content, code, open } = await app();
      if (otherTicketOpen) {
        await store.createTicket(PROJECT, { ...ticketInput('Sample ticket 5'), questions: ['Sample question.'] });
      }
      for (const k of [1, 2, 3]) await store.createAnswer(ticket.id, answerFrom(code(k), 'Sample answer.'));
      await open();

      await click(content(), 'Done');

      expect((await store.getTicket(ticket.id)).state).toBe('closed');
      expect(text(content().querySelector('.note.ok'))).toBe('All questions answered. Sample ticket 4 is closed.');
      const folder = await store.openProjectFolder(PROJECT);
      expect(starts).toEqual(
        prdWriterStarted ? [{ kind: 'grilling', folder, firstMessage: '/grillo-prd', title: 'Grilling · PRD' }] : [],
      );
      expect(buttonNamed(content(), 'Open the PRD writer') !== undefined).toBe(prdWriterStarted);
    },
  );

  it('says the decision is on the map when the ticket closes with one', async () => {
    const { store, ticket, content, code, open } = await app();
    for (const k of [1, 2, 3]) await store.createAnswer(ticket.id, answerFrom(code(k), 'Sample answer.'));
    await store.createDecision(ticket.id, { text: 'Sample decision.', gist: 'Sample gist.', sources: [], via: null });
    await open();

    await click(content(), 'Done');

    expect(text(content().querySelector('.note.ok'))).toBe(
      'All questions answered. Sample ticket 4 is closed, and its decision is on the map.',
    );
    expect((await store.getMap(PROJECT)).settled).toEqual([{ ticket: ticket.id.number, gist: 'Sample gist.' }]);
  });

  it.each([
    ['no ticket at all', () => ({}), 'Open a ticket from the Tickets tab to answer it here.'],
    ['a ticket that is not a number', () => ({ project: PROJECT, ticket: '4a' }), 'Open a ticket from the Tickets tab to answer it here.'],
    ['a project that is not owner/repo', () => ({ project: 'sample', ticket: '2' }), 'Open a ticket from the Tickets tab to answer it here.'],
    ['an unknown ticket', () => ({ project: PROJECT, ticket: '999' }), `No ticket 999 in ${PROJECT}`],
  ])('shows why it cannot open %s', async (_case, params, message) => {
    const { content, open } = await app();

    await open(params());

    expect(text(content().querySelector('.note.err'))).toBe(message);
  });

  it.each([
    ['held by another member', (s: Store, id: TicketId) => s.sendTicket(id, 'ben-example'), 'Sample ticket 4 is taken by ben-example. Only they can answer it now; you can still read it on the Tickets tab.'],
    ['closed', (s: Store, id: TicketId) => s.closeTicket(id), 'Sample ticket 4 is closed: there is nothing left to answer.'],
  ])('leaves a ticket %s untouched and says why', async (_case, stage, message) => {
    const { store, ticket, content, open } = await app();
    await stage(store, ticket.id);
    const before = await store.getTicket(ticket.id);

    await open();

    expect(text(content().querySelector('.note.warn'))).toBe(message);
    expect(content().querySelector('textarea')).toBeNull();
    expect(await store.getTicket(ticket.id)).toEqual(before);
  });
});

function ticketInput(title: string) {
  return { title, question: 'A made-up question?', whyItMatters: 'Sample section: a reason.', assumptions: [], kind: 'grilling' as const, blockers: [] };
}

describe('own-time answering: reading what the store returns', () => {
  const id: TicketId = { project: PROJECT, number: 2 };
  const goodTicket: Ticket = {
    id,
    ...ticketInput('Sample ticket 2'),
    domains: [],
    noDomain: true,
    assignee: null,
    state: 'open',
    duplicateOf: null,
    questions: [
      { code: 'Q2.1', text: 'Sample one', answered: true },
      { code: 'Q2.1', text: 'Sample one again', answered: false },
      { code: 'Q2.2', text: 'Sample two', answered: false },
    ],
  };
  const member = { login: 'ada-example', name: null, email: null, role: '', domains: [] };
  const answer = (question: string, words: string, when: string) => ({ id: `c-${words}`, ticket: id, who: 'ada-example', when, sources: [], via: null, question, text: words });
  const storeReturning = (ticket: unknown, answers: unknown = [], who: unknown = member) =>
    ({ getTicket: async () => ticket, listAnswers: async () => answers, currentMember: async () => who }) as unknown as Store;

  it.each([
    ['no ticket', null],
    ['a ticket without questions', { ...goodTicket, questions: null }],
    ['a question without a code', { ...goodTicket, questions: [{ code: '', text: 'x', answered: false }] }],
    ['a question with a null text', { ...goodTicket, questions: [{ code: 'Q2.1', text: null, answered: false }] }],
    ['an unknown state', { ...goodTicket, state: 'gone' }],
    ['domains that are not text', { ...goodTicket, domains: [null] }],
  ])('refuses %s with the one store error the screen shows', async (_case, ticket) => {
    await expect(readTicketView(storeReturning(ticket), id)).rejects.toMatchObject({ name: 'StoreError', kind: 'backend' });
  });

  it.each([
    ['answers that are no list', storeReturning(goodTicket, null)],
    ['no member', storeReturning(goodTicket, [], null)],
  ])('refuses %s with the same error', async (_case, store) => {
    await expect(readTicketView(store, id)).rejects.toBeInstanceOf(StoreError);
  });

  it('keeps each question code once, ignores answers to unknown questions or of no shape, and shows the latest answer', async () => {
    const answers = [
      answer('Q2.1', 'older', '2026-10-21T09:00:00.000Z'),
      answer('Q2.1', 'newer', '2026-10-22T09:00:00.000Z'),
      answer('Q9.9', 'unknown question', '2026-10-22T09:00:00.000Z'),
      null,
      { question: 'Q2.1' },
    ];

    const view = await readTicketView(storeReturning(goodTicket, answers), id);

    expect(view.questions.map(({ code, text: words, answered, answer: saved }) => [code, words, answered, saved?.text ?? null])).toEqual([
      ['Q2.1', 'Sample one', true, 'newer'],
      ['Q2.2', 'Sample two', false, null],
    ]);
  });
});

describe('own-time answering: with a grilling agent', () => {
  const panel = (content: HTMLElement) => content.querySelector<HTMLElement>('.agent-tab .own-time-panel');

  it('starts /grillo-answer <ticket> as a grilling agent in the project folder and opens its tab, questions and Done beside the terminal', async () => {
    const { store, ticket, starts, content, code, open } = await app();
    await store.createAnswer(ticket.id, answerFrom(code(1), 'Sample answer.'));
    await open();

    await click(content(), 'With a grilling agent');

    const folder = await store.openProjectFolder(PROJECT);
    expect(starts).toEqual([
      { kind: 'grilling', folder, firstMessage: `/grillo-answer ${ticket.id.number}`, title: 'Grilling · Sample ticket 4' },
    ]);
    const shown = panel(content()) as HTMLElement;
    expect(shown.hidden).toBe(false);
    expect(content().querySelector('.agent-tab .agent-tab-body .agent-terminal')).not.toBeNull();
    expect(text(shown.querySelector('.own-time-head h3'))).toBe('Sample ticket 4');
    expect(text(shown.querySelector('.own-time-head .seg [aria-pressed="true"]'))).toBe('With a grilling agent');
    expect(texts(shown.querySelectorAll('.own-time-side .rows li'))).toEqual([
      `${code(1)} ${QUESTIONS[0]}Answered`,
      `${code(2)} ${QUESTIONS[1]}Open`,
      `${code(3)} ${QUESTIONS[2]}Open`,
    ]);
    expect(buttonNamed(shown, 'Done')?.disabled).toBe(false);
  });

  it('opens the agent already answering the ticket instead of starting a second one, and In a form comes back', async () => {
    const { starts, content, open } = await app();
    await open();
    await click(content(), 'With a grilling agent');

    await click(panel(content()) as HTMLElement, 'In a form');
    expect(content().querySelector('.own-time > .card textarea')).not.toBeNull();
    await click(content(), 'With a grilling agent');

    expect(starts).toHaveLength(1);
    expect(panel(content())?.hidden).toBe(false);
  });

  it('Done types done into the agent and leaves closing or releasing the ticket to it; the outcome shows once it has', async () => {
    const { store, ticket, ptys, content, code, open } = await app();
    await open();
    await click(content(), 'With a grilling agent');

    await click(panel(content()) as HTMLElement, 'Done');
    await enterPressed();

    expect(ptys[0].written).toEqual(['done', '\r']);
    expect(await store.getTicket(ticket.id)).toMatchObject({ state: 'open', assignee: 'ada-example' });
    expect(text(panel(content())?.querySelector('.note'))).toBe(
      'Done sent. The agent closes the ticket, or returns it to the pool with its open questions, then stops.',
    );
    expect(buttonNamed(panel(content()) as HTMLElement, 'Done')?.disabled).toBe(true);

    // The agent records the last answers and the decision and closes the ticket; the member comes back to its tab.
    for (const k of [1, 2, 3]) await store.createAnswer(ticket.id, answerFrom(code(k), 'Sample answer.'));
    await store.createDecision(ticket.id, { text: 'Sample decision.', gist: 'Sample gist.', sources: [], via: null });
    await store.closeTicket(ticket.id);
    const tabName = document.querySelector<HTMLElement>('nav .tab[data-agent-id] .tab-name');
    shell?.navigate('map');
    tabName?.click();
    await flush();
    await flush();

    expect(text(panel(content())?.querySelector('.note.ok'))).toBe(
      'All questions answered. Sample ticket 4 is closed, and its decision is on the map.',
    );
  });

  it("sends the form's Done to the agent still answering the ticket instead of closing it a second way", async () => {
    const { store, ticket, ptys, starts, content, code, open } = await app();
    for (const k of [1, 2, 3]) await store.createAnswer(ticket.id, answerFrom(code(k), 'Sample answer.'));
    await open();
    await click(content(), 'With a grilling agent');
    await click(panel(content()) as HTMLElement, 'In a form');

    await click(content(), 'Done');
    await enterPressed();

    expect(ptys[0].written).toEqual(['done', '\r']);
    expect(await store.getTicket(ticket.id)).toMatchObject({ state: 'open', assignee: 'ada-example' });
    expect(starts).toHaveLength(1);
    expect(text(content().querySelector('.own-time > .note'))).toBe(
      'Done sent. The agent closes the ticket, or returns it to the pool with its open questions, then stops.',
    );
    expect(buttonNamed(content(), 'Done')?.disabled).toBe(true);
  });

  it('stops counting an agent that finished the ticket once the member takes it back: the form closes it itself', async () => {
    const { store, ticket, ptys, content, code, open } = await app();
    await open();
    await click(content(), 'With a grilling agent');
    await click(panel(content()) as HTMLElement, 'Done');
    await enterPressed();
    // The agent releases the ticket with its questions open; its Claude Code keeps running.
    await store.releaseTicket(ticket.id);
    for (const k of [1, 2, 3]) await store.createAnswer(ticket.id, answerFrom(code(k), 'Sample answer.'));

    await click(panel(content()) as HTMLElement, 'In a form');
    await click(content(), 'Done');

    expect(ptys[0].written).toEqual(['done', '\r']);
    expect((await store.getTicket(ticket.id)).state).toBe('closed');
    expect(text(content().querySelector('.note.ok'))).toBe('All questions answered. Sample ticket 4 is closed.');
  });

  it('refreshes the answered states when the agent goes quiet after recording an answer', async () => {
    const { store, ticket, ptys, content, code, open } = await app();
    await open();
    await click(content(), 'With a grilling agent');
    vi.useFakeTimers();

    await store.createAnswer(ticket.id, answerFrom(code(2), 'Sample answer.'));
    ptys[0].print('✓ Recorded answer to question 2.\r\n');
    await vi.advanceTimersByTimeAsync(WAITING_AFTER_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(texts(panel(content())?.querySelectorAll('.rows .badge') ?? [])).toEqual(['Open', 'Answered', 'Open']);
  });

  it('types a pasted or uploaded transcript with "use it" on its own last line, then Enter', async () => {
    const { ptys, content, open } = await app();
    await open();
    await click(content(), 'With a grilling agent');
    const shown = panel(content()) as HTMLElement;
    const field = shown.querySelector<HTMLTextAreaElement>('textarea[aria-label="Transcript"]') as HTMLTextAreaElement;

    await click(shown, 'Import a transcript (paste or upload)');
    expect(buttonNamed(shown, 'Use it')?.disabled).toBe(true);
    const fileInput = shown.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['Sample line from a file.\r\nSample reply.\r\n\r\n'], 'sample-call.txt', { type: 'text/plain' })],
    });
    fileInput.dispatchEvent(new Event('change'));
    await flush();
    await flush();
    expect(field.value).toBe('Sample line from a file.\r\nSample reply.\r\n\r\n');
    await click(shown, 'Use it');
    await enterPressed();

    expect(ptys[0].written).toEqual(['Sample line from a file.\nSample reply.\nuse it', '\r']);
    expect(text(shown.querySelector('.note'))).toBe('Transcript sent with "use it": the agent takes the answers from it and records them.');

    await click(shown, 'Import a transcript (paste or upload)');
    expect(field.value).toBe('');
    typeInto(field, 'Sample pasted line.');
    await click(shown, 'Use it');
    await enterPressed();
    expect(ptys[0].written.slice(2)).toEqual(['Sample pasted line.\nuse it', '\r']);
  });

  it('stays hidden on a grilling agent the screen did not start, leaving its tab without a side column', async () => {
    const { grillo, content } = await app();
    const agentId = await grillo.invoke('agents:start', { kind: 'grilling', folder: '/projects/sample-1', firstMessage: '', title: 'Grilling · Sample idea' });
    shell?.navigate('agent-tab', { agentId });
    await flush();

    expect(panel(content())?.hidden).toBe(true);
    expect(panel(content())?.querySelector('h3')).toBeNull();
    expect(content().querySelector('.agent-tab .agent-terminal')).not.toBeNull();
  });

  it('shows why the agent could not start and stays on the form', async () => {
    const { content, open } = await app({ claudeMissing: true });
    await open();

    await click(content(), 'With a grilling agent');

    expect(text(content().querySelector('.own-time .note.err'))).toContain('Claude Code is not installed on this laptop');
    expect(content().querySelector('.own-time > .card textarea')).not.toBeNull();
  });
});
