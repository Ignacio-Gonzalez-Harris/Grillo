/**
 * Own-time answering with a grilling agent (prototype `screen-own-time-answering`, state "With a grilling agent"):
 * a panel on the agent tab of every agent the own-time screen started. It shows the ticket's heading row above the
 * terminal and, beside it, the questions with their answered state, a transcript import and Done.
 *
 * The agent records the answers, so this panel never writes to the store: Done types `done`, and a transcript is
 * typed with `use it` (`resources/skills/README.md`, Screen-to-agent protocol). On any other grilling agent the panel
 * stays hidden.
 */
import './own-time.css';
import type { TicketId } from '../../../main/store/types';
import type { AgentInfo } from '../../../shared/agents';
import { createStoreClient } from '../../../shared/store';
import { button } from '../../theme/components';
import type { TabPanel } from '../agent-tab/tab-panels';
import { DONE_SENT, sendDone, sendUseIt, type OwnTimeAgents } from './agents';
import { readTicketView, type TicketView } from './ticket';
import { closedOutcome, el, headingRow, messageOf, note, questionRows, releasedOutcome } from './view';

/** The own-time screen's id, where "In a form" goes. */
export const OWN_TIME_SCREEN = 'own-time';
/** Above other grilling controls, so the questions come first in the column. */
export const OWN_TIME_PANEL_PRIORITY = 10;

const TRANSCRIPT_SENT = 'Transcript sent with "use it": the agent takes the answers from it and records them.';
const TRANSCRIPT_FILES = '.txt,.md,.vtt,.srt,text/plain';

export interface OwnTimePanelOptions {
  agents: OwnTimeAgents;
}

type Outcome = 'closed' | 'released';

export function ownTimePanel({ agents }: OwnTimePanelOptions): TabPanel {
  return {
    kinds: ['grilling'],
    slot: 'controls',
    priority: OWN_TIME_PANEL_PRIORITY,
    mount(container, { agent, grillo, shell }) {
      const store = createStoreClient(grillo);
      let ticket: TicketId | undefined;
      let view: TicketView | null = null;
      let loadError: string | null = null;
      let message: { text: string; error: boolean } | null = null;
      let doneSent = false;
      let outcome: Outcome | null = null;
      let busy = false;
      let disposed = false;
      let waiting = agent.waiting;

      // The parts stay in place between redraws, so a transcript being pasted keeps its focus while the questions
      // refresh beside it.
      const head = el('div', 'own-time-head');
      const status = el('div', 'stack');
      const messages = el('div', 'stack');
      const transcript = el('textarea', '');
      transcript.setAttribute('aria-label', 'Transcript');
      transcript.placeholder = 'Paste a transcript of a talk about this ticket';
      const file = el('input', 'file-input');
      file.type = 'file';
      file.accept = TRANSCRIPT_FILES;
      file.setAttribute('aria-label', 'Transcript file');
      const openImport = button('Import a transcript (paste or upload)', { small: true, onClick: () => showImport(true) });
      const upload = button('Upload transcript file', { small: true, onClick: () => file.click() });
      const cancel = button('Cancel', { small: true, onClick: () => showImport(false) });
      const useIt = button('Use it', { small: true, variant: 'primary', onClick: () => void useTranscript() });
      const importer = el('div', 'stack', [
        transcript,
        el('div', 'row', [upload, file]),
        el('div', 'row', [el('span', 'spacer'), cancel, useIt]),
      ]);
      const opener = el('div', 'row', [openImport]);
      const done = button('Done', { variant: 'primary', onClick: () => void pressDone() });
      const side = el('div', 'card stack own-time-side', [el('h4', '', ['Questions']), status, opener, importer, messages, done]);
      const root = el('div', 'own-time own-time-panel', [head, side]);
      root.hidden = true;
      container.append(root);
      showImport(false);

      function showImport(open: boolean): void {
        importer.hidden = !open;
        opener.hidden = open;
        if (!open) transcript.value = '';
        draw();
      }

      function draw(): void {
        if (disposed) return;
        const blank = transcript.value.trim() === '';
        openImport.disabled = busy || doneSent;
        transcript.disabled = busy;
        upload.disabled = busy;
        cancel.disabled = busy;
        useIt.disabled = busy || blank;
        done.disabled = busy || doneSent;
        messages.replaceChildren(...(message ? [note(message.text, message.error ? 'err' : 'info')] : []));
      }

      function drawTicket(): void {
        if (disposed || ticket === undefined) return;
        const answering = ticket;
        head.replaceChildren(
          ...(view === null
            ? []
            : [
                headingRow(view, 'agent', (choice) => {
                  if (choice === 'form') {
                    shell.navigate(OWN_TIME_SCREEN, { project: answering.project, ticket: String(answering.number) });
                  }
                }),
              ]),
        );
        const parts: HTMLElement[] = [];
        if (loadError !== null) parts.push(note(loadError, 'err'));
        if (view === null) {
          if (loadError === null) parts.push(el('p', 'small muted', ['Loading the questions…']));
        } else if (outcome === 'closed') {
          parts.push(closedOutcome(view, true));
        } else if (outcome === 'released') {
          parts.push(...releasedOutcome(view));
        } else {
          parts.push(questionRows(view.questions));
        }
        status.replaceChildren(...parts);
      }

      async function refresh(): Promise<void> {
        if (ticket === undefined) return;
        try {
          view = await readTicketView(store, ticket);
          loadError = null;
          if (doneSent && view.ticket.state === 'closed') outcome = 'closed';
          else if (doneSent && view.ticket.assignee === null) outcome = 'released';
          // The agent has finished the ticket: it no longer answers it, though its tab stays open.
          if (outcome !== null) agents.forget(agent.id);
        } catch (error) {
          loadError = messageOf(error);
        }
        drawTicket();
      }

      async function act(work: () => Promise<string>): Promise<void> {
        if (busy) return;
        busy = true;
        message = null;
        draw();
        try {
          message = { text: await work(), error: false };
        } catch (error) {
          message = { text: messageOf(error), error: true };
        } finally {
          busy = false;
          draw();
        }
      }

      function useTranscript(): Promise<void> {
        return act(async () => {
          await sendUseIt(grillo, agent.id, transcript.value);
          showImport(false);
          return TRANSCRIPT_SENT;
        });
      }

      function pressDone(): Promise<void> {
        return act(async () => {
          await sendDone(grillo, agent.id);
          agents.markDone(agent.id);
          doneSent = true;
          return DONE_SENT;
        });
      }

      transcript.addEventListener('input', draw);
      file.addEventListener('change', () => {
        const chosen = file.files?.[0];
        file.value = '';
        if (!chosen) return;
        chosen.text().then(
          (text) => {
            transcript.value = text;
            draw();
          },
          (error: unknown) => {
            message = { text: `Grillo could not read ${chosen.name}: ${messageOf(error)}`, error: true };
            draw();
          },
        );
      });

      function activate(): void {
        if (ticket !== undefined) return;
        ticket = agents.ticketOf(agent.id);
        if (ticket === undefined) return;
        root.hidden = false;
        drawTicket();
        void refresh();
      }

      const stopAgents = agents.onChange(activate);
      const stopTabs = shell.onAgentTabs((list: readonly AgentInfo[]) => {
        const now = list.find((candidate) => candidate?.id === agent.id)?.waiting === true;
        // The agent has gone quiet after working: it may have recorded an answer or closed the ticket.
        if (now && !waiting) void refresh();
        waiting = now;
      });
      activate();

      return {
        shown: () => void refresh(),
        dispose() {
          disposed = true;
          stopAgents();
          stopTabs();
          agents.forget(agent.id);
        },
      };
    },
  };
}
