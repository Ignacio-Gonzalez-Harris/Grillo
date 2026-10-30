// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAgentChannels } from '../../../main/features/agents/channels';
import { FakePty } from '../../../main/features/agents/fake-pty';
import { WAITING_AFTER_MS } from '../../../main/features/agents/runtime';
import { createSliceBus } from '../../../main/features/audio/slices';
import { registerSessionChannels } from '../../../main/features/session/channels';
import { createSessionHost } from '../../../main/features/session/session';
import { registerStoreIpc } from '../../../main/features/store/ipc';
import { createMainIpc } from '../../../main/ipc/bridge';
import { createFakeIpc } from '../../../main/ipc/fake-ipc';
import { createMemoryStore, type MemoryStore } from '../../../main/store/memory';
import { createMemorySettings } from '../../../main/store/memory/settings';
import type { NewTicket, Store } from '../../../main/store/store';
import type { Ticket } from '../../../main/store/types';
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
import { MEETING_AGENT_TITLE, MEETING_COMMAND } from '../meeting/meeting-agents';
import meetingTabPanels from '../meeting/tab-panel';
import { PRD_COMMAND, PRD_WRITER_TITLE, TAGGING_COMMAND, TAGGING_TITLE } from './agents';
import * as mapScreen from './index';
import { readMapView } from './map-data';

// Made-up projects, members, tickets and sources only.
const NOW = new Date('2026-10-22T10:00:00.000Z');
const PROJECT = 'example-org/sample-project-1';
const FOLDER = '/memory/Grillo/example-org/sample-project-1';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) await flush();
}

function ticketInput(title: string, extra: Partial<NewTicket> = {}): NewTicket {
  return {
    title,
    question: `A made-up question for ${title}?`,
    whyItMatters: 'Sample section: a made-up reason.',
    assumptions: [],
    kind: 'grilling',
    blockers: [],
    questions: ['Sample question: a made-up question.'],
    ...extra,
  };
}

interface Setup {
  /** No map yet: the engine is still building it. */
  noMap?: boolean;
  /** Connect a repository with write access, instead of creating one (where every member is admin). */
  writeOnly?: boolean;
  /** No fog line on the map. */
  noFog?: boolean;
  /** The live session in main and the agent tab with the meeting screen's panels, as the app wires them. */
  meeting?: boolean;
}

/**
 * The app as it runs, in process: the real agent channels (Claude Code played by fake terminals) and the in-memory
 * store behind the real store IPC, the shell and this screen.
 */
async function app(setup: Setup = {}) {
  const fake = createFakeIpc();
  const ipc = createMainIpc(fake.main, () => [fake.window]);
  const ptys: FakePty[] = [];
  const runtime = registerAgentChannels(ipc, {
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
  if (setup.meeting) {
    registerSessionChannels(ipc, createSessionHost({ store, slices: createSliceBus(), transcriber: { transcribe: async () => '' }, agents: runtime }));
    // The speech model stays in preparation: these tests never record.
    ipc.handle('transcription:ensure-model', () => new Promise<void>(() => undefined));
  }

  const bridge = createGrilloApi(fake.renderer);
  const starts: StartAgentRequest[] = [];
  const grillo: GrilloApi = {
    invoke: ((channel: string, payload: unknown) => {
      if (channel === 'agents:start') starts.push(payload as StartAgentRequest);
      return (bridge.invoke as (c: string, p: unknown) => Promise<unknown>)(channel, payload);
    }) as GrilloApi['invoke'],
    on: bridge.on,
  };

  const created = setup.writeOnly
    ? await store.createProject({ connectRepository: { owner: 'example-org', name: 'team-code' } })
    : await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-1' } });
  const project = created.id;
  await store.updateMember(project, 'ada-example', { role: 'developer', domains: ['developer'] });
  if (!setup.writeOnly) await store.addMember(project, { login: 'ben-example', role: 'product', domains: ['product', 'platform'] });
  if (!setup.noMap) {
    await store.createMap(project, {
      destination: 'A PRD for Sample project 1.',
      notes: '',
      fog: setup.noFog ? [] : ['Problem: sample fog item 1, cannot be asked precisely yet.'],
      outOfScope: ['Sample out-of-scope item 1'],
    });
  }

  const root = document.createElement('div');
  document.body.append(root);
  const screens: Record<string, ScreenModule> = { '/src/renderer/screens/map/index.ts': mapScreen as ScreenModule };
  if (setup.meeting) {
    let tabs: AgentTabs | undefined;
    const panels = registerTabPanels({}, [terminalPanel(() => new FakeTerminalView()), ...meetingTabPanels]);
    screens['/src/renderer/screens/agent-tab/index.ts'] = {
      id: 'agent-tab',
      title: 'Agent',
      start(shellContext) {
        tabs = createAgentTabs(shellContext, panels);
        return () => tabs?.dispose();
      },
      mount: (el, params) => (tabs as AgentTabs).show(el, params['agentId'] ?? ''),
    };
  }
  shell = createShell(root, { grillo, screens: registerScreens(screens) });

  const content = () => root.querySelector('main') as HTMLElement;
  return {
    store,
    project,
    grillo,
    starts,
    ptys,
    content,
    async open(params: Record<string, string> = { project }) {
      shell?.navigate('map', params);
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
function fill(scope: Element, label: string, value: string): void {
  const field = [...scope.querySelectorAll('label.field')].find((candidate) => candidate.firstChild?.textContent === label);
  const input = field?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
  if (!input) throw new Error(`No field '${label}'`);
  input.value = value;
}
const card = (content: HTMLElement, heading: string) =>
  [...content.querySelectorAll<HTMLElement>('.map-screen .card')].find(
    (candidate) => text(candidate.querySelector('h3, h4')) === heading,
  );
const listed = (content: HTMLElement, heading: string) => texts(card(content, heading)?.querySelectorAll('li') ?? []);
const ticketRows = (content: HTMLElement) => [...content.querySelectorAll<HTMLTableRowElement>('table.tickets tr')].slice(1);
const ticketTitles = (content: HTMLElement) => ticketRows(content).map((row) => text(row.cells[0]));
const rowOf = (content: HTMLElement, title: string) =>
  ticketRows(content).find((row) => text(row.cells[0]) === title) as HTMLTableRowElement;
const theDialog = (content: HTMLElement) => content.querySelector('[role="dialog"]') as HTMLElement;

async function sampleTickets(store: Store, project: string): Promise<Ticket[]> {
  const one = await store.createTicket(project, ticketInput('Sample ticket 1'));
  const two = await store.createTicket(project, ticketInput('Sample ticket 2'));
  const three = await store.createTicket(project, ticketInput('Sample ticket 3', { blockers: [one.id.number] }));
  const four = await store.createTicket(project, ticketInput('Sample ticket 4', { kind: 'research' }));
  return [one, two, three, four];
}

/** Lets a running agent print, then go quiet: the tab's waiting dot. */
async function agentGoesQuiet(pty: FakePty): Promise<void> {
  pty.print('Sample agent output.\r\n');
  await vi.advanceTimersByTimeAsync(WAITING_AFTER_MS);
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  await settle();
}

describe('the map screen: engine building the map', () => {
  it('shows the empty map cards and says the engine is building while there is no map yet', async () => {
    const { content, open } = await app({ noMap: true });
    await open();

    expect(texts(content().querySelectorAll('.grid-2 .card h4'))).toEqual(['Destination', 'Settled', 'Fog', 'Out of scope']);
    expect(text(card(content(), 'Destination')?.querySelector('p'))).toBe('Not written yet.');
    expect(text(card(content(), 'Tickets')?.querySelector('.note'))).toContain('building the map and tickets from your idea');
    expect(buttonNamed(content(), 'Run tagging round')).toBeUndefined();
    expect(card(content(), 'Sources')).toBeUndefined();
    expect(card(content(), 'Project')).toBeUndefined();
  });

  it('reads the store again when an agent goes quiet, so the first tickets appear as the engine creates them', async () => {
    const { store, project, grillo, ptys, content, open } = await app();
    await grillo.invoke('agents:start', { kind: 'grilling', folder: FOLDER, firstMessage: '', title: 'Grilling · Map' });
    await open();
    expect(text(card(content(), 'Destination')?.querySelector('p'))).toBe('A PRD for Sample project 1.');
    expect(text(card(content(), 'Tickets')?.querySelector('.note'))).toContain('building the map');

    vi.useFakeTimers();
    await store.createTicket(project, ticketInput('Sample ticket 1'));
    await agentGoesQuiet(ptys[0]);

    expect(ticketTitles(content())).toEqual(['Sample ticket 1']);
    expect(text(card(content(), 'Tickets')?.querySelector('.note'))).toBe('');
  });
});

describe('the map screen: tickets untagged', () => {
  it('shows the map, every open ticket with its kind, untagged domains, assignee and blockers, and the tagging hint', async () => {
    const { store, project, content, open } = await app();
    await sampleTickets(store, project);
    await open();

    expect(listed(content(), 'Fog')).toEqual(['Problem: sample fog item 1, cannot be asked precisely yet.']);
    expect(listed(content(), 'Out of scope')).toEqual(['Sample out-of-scope item 1']);
    expect(text(card(content(), 'Settled')?.querySelector('p'))).toBe('Nothing settled yet.');
    expect(ticketTitles(content())).toEqual(['Sample ticket 1', 'Sample ticket 2', 'Sample ticket 3', 'Sample ticket 4']);
    const three = rowOf(content(), 'Sample ticket 3');
    expect([...three.cells].slice(1, 5).map(text)).toEqual(['grilling', 'untagged', '—', 'Sample ticket 1']);
    expect(text(rowOf(content(), 'Sample ticket 4').cells[1])).toBe('research');
    expect(text(card(content(), 'Tickets')?.querySelector('p.small'))).toBe(
      'An agent gives every open ticket one or more domains from the members’ domains: developer, product, platform.',
    );
    expect(buttonNamed(content(), 'Run tagging round')?.classList.contains('primary')).toBe(true);
    expect(content().querySelector('.seg')).toBeNull();
  });

  it('"Run tagging round" starts a grilling agent with /grillo-tagging in the project folder, then offers its tab', async () => {
    const { store, project, starts, content, open } = await app();
    await sampleTickets(store, project);
    await open();

    await click(content(), 'Run tagging round');

    expect(starts).toEqual([{ kind: 'grilling', folder: FOLDER, firstMessage: TAGGING_COMMAND, title: TAGGING_TITLE }]);
    expect(TAGGING_TITLE).toBe('Grilling · Tagging round');
    expect(text(card(content(), 'Tickets')?.querySelector('.note'))).toContain('The tagging round runs in its own tab.');
    await click(content(), 'Open the tagging round');
    expect(document.querySelector('.tab.active')?.textContent).toContain(TAGGING_TITLE);
  });
});

describe('the map screen: starting a live meeting', () => {
  const meetingPanel = () => document.querySelector<HTMLElement>('.agent-tab .meeting-panel');
  const ticketsHead = (content: HTMLElement) => card(content, 'Tickets')?.querySelector('.row') as HTMLElement;

  it('"Start meeting" sits beside Add ticket and Run tagging round, starts a meeting agent with /grillo-meeting and opens its tab on the meeting panel', async () => {
    const { store, project, starts, content, open } = await app({ meeting: true });
    await sampleTickets(store, project);
    await open();

    expect(texts(ticketsHead(content()).querySelectorAll('button'))).toEqual(['Add ticket', 'Run tagging round', 'Start meeting']);
    expect(buttonNamed(content(), 'Start meeting')?.className).toBe(buttonNamed(content(), 'Add ticket')?.className);
    await click(content(), 'Start meeting');

    expect(starts).toEqual([{ kind: 'grilling', folder: FOLDER, firstMessage: MEETING_COMMAND, title: MEETING_AGENT_TITLE }]);
    expect(document.querySelector('.tab.active')?.textContent).toContain(MEETING_AGENT_TITLE);
    expect(meetingPanel()?.hidden).toBe(false);
  });

  it('opens the running meeting agent’s tab instead of starting a second one, and starts a new one once it has stopped', async () => {
    const { store, project, grillo, starts, content, open } = await app({ meeting: true });
    await sampleTickets(store, project);
    await open();
    await click(content(), 'Run tagging round');
    await click(content(), 'Start meeting');
    const [, meeting] = await grillo.invoke('agents:list', undefined);

    await open();
    await click(content(), 'Start meeting');

    expect(starts.map(({ firstMessage }) => firstMessage)).toEqual([TAGGING_COMMAND, MEETING_COMMAND]);
    expect(document.querySelector('.tab.active')?.textContent).toContain(MEETING_AGENT_TITLE);
    expect(meetingPanel()?.hidden).toBe(false);

    await grillo.invoke('agents:stop', { id: meeting.id });
    await settle();
    await open();
    await click(content(), 'Start meeting');

    expect(starts.map(({ firstMessage }) => firstMessage)).toEqual([TAGGING_COMMAND, MEETING_COMMAND, MEETING_COMMAND]);
    expect(meetingPanel()?.hidden).toBe(false);
  });

  it('opens the meeting agent another project is running instead of starting a second one on this laptop', async () => {
    const { store, project, starts, content, open } = await app({ meeting: true });
    await sampleTickets(store, project);
    const other = await store.createProject({ newRepository: { organisation: 'example-org', name: 'sample-project-2' } });
    await store.createMap(other.id, { destination: 'A PRD for Sample project 2.', notes: '', fog: [], outOfScope: [] });
    await store.createTicket(other.id, ticketInput('Sample ticket 9'));
    await open();
    await click(content(), 'Start meeting');

    await open({ project: other.id });
    await click(content(), 'Start meeting');

    expect(starts.map(({ firstMessage }) => firstMessage)).toEqual([MEETING_COMMAND]);
    expect(document.querySelector('.tab.active')?.textContent).toContain(MEETING_AGENT_TITLE);
    expect(meetingPanel()?.hidden).toBe(false);
  });
});

describe('the map screen: tagged and assigned, with sources', () => {
  async function tagged() {
    const setup = await app();
    const [one, two, three, four] = await sampleTickets(setup.store, setup.project);
    await setup.store.updateTicket(one.id, { domains: ['product'] });
    await setup.store.updateTicket(two.id, { domains: ['platform'] });
    await setup.store.updateTicket(three.id, { domains: ['developer', 'product'] });
    await setup.store.updateTicket(four.id, { noDomain: true });
    await setup.store.sendTicket(two.id, 'ben-example');
    return { ...setup, tickets: [one, two, three, four] };
  }

  it('shows the domain tags in the declared order of colours, the locks, and the actions each row allows', async () => {
    const { content, open } = await tagged();
    await open();

    const tags = (title: string) => [...rowOf(content(), title).cells[2].querySelectorAll('.tag')].map((tag) => `${tag.className}:${text(tag)}`);
    expect(tags('Sample ticket 3')).toEqual(['tag d1:developer', 'tag d2:product']);
    expect(tags('Sample ticket 2')).toEqual(['tag d3:platform']);
    expect(tags('Sample ticket 4')).toEqual(['tag none:no domain']);
    const locked = rowOf(content(), 'Sample ticket 2');
    expect(text(locked.cells[3])).toBe('ben-exampleLocked');
    expect(texts(locked.cells[5].querySelectorAll('button'))).toEqual(['Edit']);
    expect(texts(rowOf(content(), 'Sample ticket 1').cells[5].querySelectorAll('button'))).toEqual([
      'Edit',
      'Merge',
      'Close as out of scope',
    ]);
    expect(buttonNamed(content(), 'Run tagging round')?.classList.contains('primary')).toBe(false);
    expect(text(card(content(), 'Tickets')?.querySelector('p.small'))).toBe('Rerun the tagging round when members join.');
  });

  it('flags a ticket the store could not read with the reason and no actions, and shows every other ticket as usual', async () => {
    const { content, open, store, project } = await tagged();
    const reason = 'Issue #3 carries 2 kind labels; a ticket has exactly one';
    const listed = await store.listTickets(project);
    vi.spyOn(store, 'listTickets').mockResolvedValue(listed.map((ticket) => (ticket.title === 'Sample ticket 2' ? { ...ticket, damaged: reason } : ticket)));
    await open();

    const damaged = ticketRows(content()).find((row) => text(row.cells[0]).startsWith('Sample ticket 2')) as HTMLTableRowElement;
    expect(texts(damaged.cells[0].querySelectorAll('.badge'))).toEqual(['Damaged']);
    expect(text(damaged.cells[0].querySelector('.reason'))).toBe(`${reason} Fix the issue on GitHub; the other tickets work as usual.`);
    expect(damaged.cells[5].querySelectorAll('button')).toHaveLength(0);
    expect(ticketRows(content())).toHaveLength(4);
    expect(texts(rowOf(content(), 'Sample ticket 1').cells[5].querySelectorAll('button'))).toEqual(['Edit', 'Merge', 'Close as out of scope']);
  });

  it('puts the tickets of my domains first, and All keeps them in number order', async () => {
    const { content, open } = await tagged();
    await open();

    expect(text(content().querySelector('.seg [aria-pressed="true"]'))).toBe('My domains first');
    expect(ticketTitles(content())).toEqual(['Sample ticket 3', 'Sample ticket 4', 'Sample ticket 1', 'Sample ticket 2']);
    await click(content().querySelector('.seg') as HTMLElement, 'All');
    expect(ticketTitles(content())).toEqual(['Sample ticket 1', 'Sample ticket 2', 'Sample ticket 3', 'Sample ticket 4']);
  });

  it('lists every source with its code, kind, who, when and where, and opens one in a glass panel with its full text', async () => {
    const { store, project, content, open } = await tagged();
    await store.createSource(project, {
      kind: 'document',
      who: 'Ada Example, developer',
      when: '2026-10-20T09:00:00.000Z',
      where: 'Kick-off notes, uploaded at project start',
      text: 'Sample idea line one.',
    });
    await store.createSource(project, {
      kind: 'meeting',
      who: 'ada-example (host), ben-example',
      when: '2026-10-21T10:00:00.000Z',
      where: 'Grilling session 1',
      text: 'Sample transcript line: a made-up remark.\nSample transcript line: a made-up reply.',
    });
    await open();

    const rows = [...(card(content(), 'Sources')?.querySelectorAll('table.sources tr') ?? [])].slice(1);
    expect(rows.map((row) => texts(row.querySelectorAll('td')).slice(0, 5))).toEqual([
      ['S1', 'Document', 'Ada Example, developer', '2026-10-20', 'Kick-off notes, uploaded at project start'],
      ['S2', 'Meeting', 'ada-example (host), ben-example', '2026-10-21', 'Grilling session 1'],
    ]);

    await click(rows[1], 'Open');
    const panel = theDialog(content());
    expect(panel.classList.contains('glass-strong')).toBe(true);
    expect(panel.getAttribute('aria-label')).toBe('Source S2');
    expect(text(panel.querySelector('h3'))).toBe('Grilling session 1');
    expect(texts(panel.querySelectorAll('tr td'))).toEqual(['Meeting', 'ada-example (host), ben-example', '2026-10-21, 10:00 UTC', 'Grilling session 1']);
    expect(texts(panel.querySelectorAll('.transcript p'))).toEqual([
      'Sample transcript line: a made-up remark.',
      'Sample transcript line: a made-up reply.',
    ]);
    expect(card(content(), 'Tickets')).toBeUndefined();

    await click(panel, 'Close');
    expect(theDialog(content())).toBeNull();
    expect(card(content(), 'Sources')).toBeDefined();
  });

  it('shows each settled line with its ticket title', async () => {
    const { store, project, tickets, content, open } = await tagged();
    await store.createDecision(tickets[0].id, { text: 'Sample decision.', gist: 'sample decision gist, one line.', sources: [], via: null });
    await store.closeTicket(tickets[0].id);
    await open();

    expect(listed(content(), 'Settled')).toEqual(['Sample ticket 1: sample decision gist, one line.']);
    expect(ticketTitles(content())).not.toContain('Sample ticket 1');
    void project;
  });
});

describe('the map screen: ticket actions', () => {
  it('Add ticket creates a ticket with its questions, one per line', async () => {
    const { store, project, content, open } = await app();
    await sampleTickets(store, project);
    await open();

    await click(content(), 'Add ticket');
    const form = theDialog(content());
    fill(form, 'Title', '  Sample ticket 5 ');
    fill(form, 'Kind', 'task');
    fill(form, 'Question', 'A made-up question?');
    fill(form, 'Questions, one per line (none: the question above is the only one)', 'Sample question A\n\n Sample question B ');
    await click(form, 'Add ticket');

    const added = (await store.listTickets(project)).find((ticket) => ticket.title === 'Sample ticket 5');
    expect(added).toMatchObject({ kind: 'task', question: 'A made-up question?', state: 'open' });
    expect(added?.questions.map(({ text: words }) => words)).toEqual(['Sample question A', 'Sample question B']);
    expect(theDialog(content())).toBeNull();
    expect(ticketTitles(content())).toContain('Sample ticket 5');
  });

  it('Add ticket refuses a ticket with no title and keeps the dialog open', async () => {
    const { store, project, content, open } = await app();
    await sampleTickets(store, project);
    await open();

    await click(content(), 'Add ticket');
    fill(theDialog(content()), 'Question', 'A made-up question?');
    await click(theDialog(content()), 'Add ticket');

    expect(text(content().querySelector('.note.err'))).toBe('Give the ticket a title and a question.');
    expect(theDialog(content())).not.toBeNull();
    expect(await store.listTickets(project)).toHaveLength(4);
  });

  it('Edit changes the title, kind, question and why it matters', async () => {
    const { store, project, content, open } = await app();
    const [one] = await sampleTickets(store, project);
    await open();

    await click(rowOf(content(), 'Sample ticket 1'), 'Edit');
    fill(theDialog(content()), 'Title', 'Sample ticket 1, renamed');
    fill(theDialog(content()), 'Kind', 'prototype');
    await click(theDialog(content()), 'Save');

    expect(await store.getTicket(one.id)).toMatchObject({ title: 'Sample ticket 1, renamed', kind: 'prototype', question: one.question });
    expect(text(rowOf(content(), 'Sample ticket 1, renamed').cells[1])).toBe('prototype');
  });

  it('Merge closes the ticket as a duplicate of the one picked, and starts no PRD writer while tickets stay open', async () => {
    const { store, project, starts, content, open } = await app();
    const [one, two] = await sampleTickets(store, project);
    await open();

    await click(rowOf(content(), 'Sample ticket 1'), 'Merge');
    fill(theDialog(content()), 'Merge into', String(two.id.number));
    await click(theDialog(content()), 'Merge');

    expect(await store.getTicket(one.id)).toMatchObject({ state: 'closed', duplicateOf: two.id.number });
    expect(ticketTitles(content())).not.toContain('Sample ticket 1');
    expect(starts).toEqual([]);
  });

  it('Close as out of scope writes a line naming the ticket under Out of scope and closes it with no decision', async () => {
    const { store, project, content, open } = await app();
    const [one] = await sampleTickets(store, project);
    await open();

    await click(rowOf(content(), 'Sample ticket 1'), 'Close as out of scope');
    fill(theDialog(content()), 'Why it is out of scope (optional)', ' beyond this PRD ');
    await click(theDialog(content()), 'Close as out of scope');

    expect((await store.getMap(project)).outOfScope).toEqual([
      'Sample out-of-scope item 1',
      `Sample ticket 1: beyond this PRD (#${one.id.number})`,
    ]);
    expect(await store.getTicket(one.id)).toMatchObject({ state: 'closed' });
    expect(await store.listDecisions(one.id)).toEqual([]);
    expect(listed(content(), 'Out of scope')).toContain(`Sample ticket 1: beyond this PRD (#${one.id.number})`);
  });

  it('Close as out of scope on the last open ticket with no fog left is map done: the PRD writer starts with /grillo-prd', async () => {
    const { store, project, starts, content, open } = await app({ noFog: true });
    const one = await store.createTicket(project, ticketInput('Sample ticket 1'));
    await store.createTicket(project, ticketInput('Sample ticket 2'));
    await store.closeTicket(one.id);
    await open();

    await click(rowOf(content(), 'Sample ticket 2'), 'Close as out of scope');
    await click(theDialog(content()), 'Close as out of scope');

    expect(starts).toEqual([{ kind: 'grilling', folder: FOLDER, firstMessage: PRD_COMMAND, title: PRD_WRITER_TITLE }]);
    expect(text(content().querySelector('.note.ok span'))).toBe(
      'The map is done: no open tickets and no fog. Grillo is writing the PRD now.',
    );
    expect(text(card(content(), 'Fog')?.querySelector('p'))).toBe('No fog left.');
    expect(text(card(content(), 'Tickets')?.querySelector('p'))).toBe('All 2 tickets are closed.');
    await click(content().querySelector('.note.ok') as HTMLElement, 'Open the PRD writer');
    expect(document.querySelector('.tab.active')?.textContent).toContain(PRD_WRITER_TITLE);
  });
});

describe('the map screen: map done', () => {
  it('a map already done shows the done note with Open the PRD, and starts nothing itself', async () => {
    const { store, project, starts, content, open } = await app({ noFog: true });
    const one = await store.createTicket(project, ticketInput('Sample ticket 1'));
    await store.closeTicket(one.id);
    await open();

    expect(text(content().querySelector('.note.ok span'))).toBe('The map is done: no open tickets and no fog.');
    expect(text(card(content(), 'Tickets')?.querySelector('p'))).toBe('The only ticket is closed.');
    expect(buttonNamed(content(), 'Run tagging round')).toBeUndefined();
    expect(starts).toEqual([]);
    await click(content().querySelector('.note.ok') as HTMLElement, 'Open the PRD');
    expect(text(content().querySelector('.empty-screen'))).toBe('PRD is not built yet.');
  });

  it('an archived project shows that it is archived, not that its map is done', async () => {
    const { store, project, content, open } = await app({ noFog: true });
    const one = await store.createTicket(project, ticketInput('Sample ticket 1'));
    await store.closeTicket(one.id);
    await store.archiveProject(project);
    await open();

    expect(text(content().querySelector('.note.warn span'))).toBe(
      'The repository is archived: everything stays readable and nothing can change.',
    );
    expect(content().querySelector('.note.ok')).toBeNull();
  });
});

describe('the map screen: closing and reopening the project', () => {
  it('Close project archives the repository; the archived map is readable, nothing changes, and Reopen unarchives it', async () => {
    const { store, project, content, open } = await app();
    await sampleTickets(store, project);
    await open();

    expect(text(card(content(), 'Project')?.querySelector('.small.muted'))).toBe(
      'Closing archives the repository: everything stays readable and nothing can change. A repository admin can reopen it.',
    );
    await click(card(content(), 'Project') as HTMLElement, 'Close project');

    expect((await store.getProject(project)).archived).toBe(true);
    expect(text(content().querySelector('.note.warn'))).toContain('The repository is archived');
    expect(card(content(), 'Project')).toBeUndefined();
    expect(buttonNamed(content(), 'Add ticket')?.disabled).toBe(true);
    expect(buttonNamed(content(), 'Run tagging round')?.disabled).toBe(true);
    expect(buttonNamed(content(), 'Start meeting')).toBeUndefined();
    expect(text(card(content(), 'Tickets')?.querySelector('.reason'))).toBe('Archived: reopen the project to change anything.');
    expect(rowOf(content(), 'Sample ticket 1').querySelectorAll('button')).toHaveLength(0);
    expect(card(content(), 'Sources')).toBeDefined();

    await click(content().querySelector('.note.warn') as HTMLElement, 'Reopen');

    expect((await store.getProject(project)).archived).toBe(false);
    expect(content().querySelector('.note.warn')).toBeNull();
    expect(buttonNamed(content(), 'Add ticket')?.disabled).toBe(false);
    expect(buttonNamed(content(), 'Start meeting')?.disabled).toBe(false);
  });

  it('greys out Close project with the reason when the member is not a repository admin', async () => {
    const { store, project, content, open } = await app({ writeOnly: true });
    await store.createTicket(project, ticketInput('Sample ticket 1'));
    await open();

    const projectCard = card(content(), 'Project') as HTMLElement;
    expect(buttonNamed(projectCard, 'Close project')?.disabled).toBe(true);
    expect(text(projectCard.querySelector('.reason'))).toBe('Only a repository admin can close the project; you have write access.');
  });
});

describe('the map screen: which project, and what it cannot read', () => {
  it('opens the project opened last on this laptop when it is opened with no project', async () => {
    const { store, project, content, open } = await app();
    await sampleTickets(store, project);
    await store.openProjectFolder(project);
    await open({});

    expect(ticketTitles(content())).toHaveLength(4);
  });

  it('says to open a project when there is none to show', async () => {
    const { content, open } = await app();
    await open({});

    expect(text(content().querySelector('.note.err'))).toBe('Open a project from the Project tab to see its map.');
  });

  it('shows a store refusal in place of the map', async () => {
    const { content, open } = await app();
    await open({ project: 'example-org/no-such-project' });

    expect(text(content().querySelector('.note.err'))).toBe('No project example-org/no-such-project');
  });
});

describe('readMapView: what the store answers is checked before it is drawn', () => {
  const member = { login: 'ada-example', name: null, email: null, role: '', domains: [] };
  const goodTicket = {
    id: { project: PROJECT, number: 2 },
    title: 'Sample ticket 2',
    question: '',
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
  const goodSource = { code: 'S1', kind: 'document', who: 'Ada Example', when: '2026-10-20T09:00:00.000Z', where: 'Sample', text: '' };

  function storeAnswering(answers: { map?: unknown; tickets?: unknown; sources?: unknown; project?: unknown; permission?: unknown }): Store {
    const answer = (key: keyof typeof answers, fallback: unknown) => async () => (key in answers ? answers[key] : fallback);
    return {
      getProject: answer('project', { id: PROJECT, name: 'sample-project-1', archived: false, members: [member] }),
      viewerPermission: answer('permission', 'admin'),
      currentMember: async () => member,
      getMap: answer('map', { number: 1, destination: 'A PRD for a sample.', notes: '', settled: [], fog: [], outOfScope: [] }),
      listTickets: answer('tickets', [goodTicket]),
      listSources: answer('sources', [goodSource]),
    } as unknown as Store;
  }

  it.each([
    ['a null ticket', { tickets: [null] }],
    ['a ticket with a null domain', { tickets: [{ ...goodTicket, domains: [null] }] }],
    ['a ticket of an unknown kind', { tickets: [{ ...goodTicket, kind: 'meeting' }] }],
    ['a blocker that is no issue number', { tickets: [{ ...goodTicket, blockers: ['#1'] }] }],
    ['a ticket list that is no list', { tickets: null }],
    ['a null source', { sources: [null] }],
    ['a map with a null fog line', { map: { number: 1, destination: '', notes: '', settled: [], fog: [null], outOfScope: [] } }],
    ['a settled line with no ticket number', { map: { number: 1, destination: '', notes: '', settled: [{ gist: 'x' }], fog: [], outOfScope: [] } }],
    ['a member with no domain list', { project: { id: PROJECT, name: 'x', archived: false, members: [{ login: 'ada-example' }] } }],
    ['an unknown permission', { permission: 'owner' }],
  ])('refuses %s with the one store error the screen shows', async (_, answers) => {
    const refusal = readMapView(storeAnswering(answers), PROJECT);
    await expect(refusal).rejects.toBeInstanceOf(StoreError);
    await expect(refusal).rejects.toMatchObject({ kind: 'backend' });
  });

  it('keeps each ticket number and source code once, the first wins, and puts the tickets in number order', async () => {
    const view = await readMapView(
      storeAnswering({
        tickets: [goodTicket, { ...goodTicket, id: { project: PROJECT, number: 1 } }, { ...goodTicket, title: 'Duplicate' }],
        sources: [goodSource, { ...goodSource, where: 'Duplicate' }],
      }),
      PROJECT,
    );
    expect(view.tickets.map(({ id, title }) => `${id.number} ${title}`)).toEqual(['1 Sample ticket 2', '2 Sample ticket 2']);
    expect(view.sources.map(({ where }) => where)).toEqual(['Sample']);
  });

  it('reads a missing map as the engine still building, and lets any other refusal through', async () => {
    const missing = storeAnswering({});
    missing.getMap = async () => {
      throw new StoreError('not-found', 'No map');
    };
    expect((await readMapView(missing, PROJECT)).map).toBeNull();

    const broken = storeAnswering({});
    broken.getMap = async () => {
      throw new StoreError('backend', 'gh failed');
    };
    await expect(readMapView(broken, PROJECT)).rejects.toMatchObject({ kind: 'backend', message: 'gh failed' });
  });
});
