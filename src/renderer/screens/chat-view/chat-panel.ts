/**
 * The chat view (prototype `screen-chat-view`; PRD section 4.6 item 1, 4.5 item 5): the body of every chat agent's
 * tab. Message bubbles, clickable answer buttons, permission prompts with Allow and Deny, a message box with Send,
 * and a "Show terminal" switch that reveals the agent's raw event stream underneath, read-only (a chat agent has no
 * terminal). A terminal agent's tab (`GRILLO_AGENT_RUNTIME=terminal`) keeps the built-in terminal body.
 *
 * Everything goes through the agent chat protocol's channels (`agent-chat:*`) with the tab's id, which the chat
 * agent shares. While the agent's Open channel holds live transcript words, the box shows them and the meeting's
 * "Use it" sends them (the session holds them in main and sends them as one message).
 */
import './chat-view.css';
import type { ChatActionResult, ChatAnswer, ChatMessage, ChatQuestionItem } from '../../../shared/agent-chat';
import type { AgentInfo } from '../../../shared/agents';
import type { GrilloApi, Unsubscribe } from '../../../shared/ipc';
import { createSessionClient } from '../../../shared/session-ipc';
import { badge, button, toggle } from '../../theme/components';
import { terminalPanel } from '../agent-tab/terminal-panel';
import type { MountedPanel, TabPanel, TabPanelContext } from '../agent-tab/tab-panels';
import { el } from '../own-time/view';
import { appChatLog, MAX_RAW_LINES, type ChatLog } from './chat-log';

/** Above the built-in terminal (priority 0), so every chat agent's tab shows the chat view. */
export const CHAT_VIEW_PRIORITY = 10;
export const RAW_STREAM_HEADER = 'Raw event stream · Claude Code in machine-readable mode · read-only';
export const USE_IT_SENDS_THE_BOX =
  "Use it sends what the message box holds as one message; the agent distils the answer and keeps the whole talk as the question's discussion.";
const BOX_PLACEHOLDER = 'Write to the agent…';
const OWN_ANSWER_PLACEHOLDER = 'Type your own answer, then Send…';
const SOMETHING_ELSE = 'Something else';
const SOMETHING_ELSE_HINT = 'Type your own answer in the message box.';
const MEMBER = 'You';
/** The separator of several picks for one question, as Claude Code's own question prompt joins them. */
const PICK_SEPARATOR = ', ';
const LINE_BREAKS = /\r?\n/g;
/** Raw event types the terminal colours, as the prototype does; a `user` line is coloured by `userTone`. */
const RAW_TONES: Readonly<Record<string, string>> = { control_request: 't-hl' };

export interface ChatViewOptions {
  /** The chat log the view reads from; the app's own, started with the shell, by default. */
  log?(grillo: GrilloApi): ChatLog;
  /** The body of a terminal agent's tab; the built-in terminal by default. */
  terminal?: TabPanel;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** "Grilling agent" for a grilling agent. */
function agentName(agent: AgentInfo): string {
  return `${agent.kind.charAt(0).toUpperCase()}${agent.kind.slice(1)} agent`;
}

/** The ticket part of a tab name "<Kind> · <ticket>", if it has one. */
function ticketOf(title: string): string | undefined {
  const at = title.indexOf(' · ');
  return at >= 0 ? title.slice(at + ' · '.length) : undefined;
}

function errorNote(text: string): HTMLElement {
  return el('p', 'note err small', [text]);
}

/** What a permission prompt would run, in one line: the command, the file, or the input itself. */
function toolSummary(input: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'url', 'path']) {
    if (typeof input[key] === 'string') return input[key];
  }
  return JSON.stringify(input);
}

/** A prompt written into the agent is plain text; a tool's result comes back as a list of content blocks. */
function userTone(event: { message?: { content?: unknown } }): string {
  return typeof event.message?.content === 'string' ? 't-prompt' : 't-ok';
}

function rawTone(line: string): string | undefined {
  try {
    const event = JSON.parse(line) as { type?: unknown; message?: { content?: unknown } } | null;
    if (event?.type === 'user') return userTone(event);
    return typeof event?.type === 'string' ? RAW_TONES[event.type] : undefined;
  } catch {
    return undefined;
  }
}

/** Asks main and turns a rejected call into a refusal, so every action has one way to fail. */
async function act(call: () => Promise<ChatActionResult>): Promise<ChatActionResult> {
  try {
    return await call();
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
}

function mountChatView(root: HTMLElement, { agent, grillo }: TabPanelContext, log: ChatLog): MountedPanel {
  const name = agentName(agent);
  const ticket = ticketOf(agent.title);
  const stops: Unsubscribe[] = [];
  let disposed = false;

  // The head: the agent's name, its ticket, the channel badge while the Open channel is on, and the switch.
  const channelBadge = el('span', 'row', [badge('Channel open', 'ok'), el('span', 'small muted', ['· receiving the transcript live'])]);
  channelBadge.hidden = true;
  const { root: terminalSwitch, input: terminalToggle } = toggle('Show terminal', {
    onChange: (on) => {
      terminal.hidden = !on;
      card.classList.toggle('show-terminal', on);
      if (on) terminal.scrollTop = terminal.scrollHeight;
    },
  });
  terminalSwitch.classList.add('small');
  const head = el('div', 'chat-head', [
    el('span', 'strong', [name]),
    ...(ticket ? [el('span', 'small muted', [`· ${ticket}`])] : []),
    channelBadge,
    el('span', 'spacer'),
    terminalSwitch,
  ]);

  const msgs = el('div', 'msgs');
  msgs.setAttribute('role', 'log');
  msgs.setAttribute('aria-label', `Chat with the ${name.toLowerCase()}`);

  const terminal = el('pre', 'terminal', [el('span', 't-muted', [RAW_STREAM_HEADER]), '\n']);
  terminal.setAttribute('aria-label', 'Raw event stream');
  terminal.hidden = true;

  const input = el('input', '');
  input.type = 'text';
  input.placeholder = BOX_PLACEHOLDER;
  input.setAttribute('aria-label', 'Write to the agent');
  const send = button('Send', { variant: 'primary', onClick: () => void sendBox() });
  const hint = el('p', 'chat-hint small muted', [USE_IT_SENDS_THE_BOX]);
  hint.hidden = true;

  const card = el('div', 'card chat chat-view', [head, msgs, terminal, el('div', 'msgbox', [input, send]), hint]);
  root.append(card);

  function show(node: HTMLElement): void {
    msgs.append(node);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function bubble(who: Array<Node | string>, body: Array<Node | string>, mine = false): HTMLElement {
    return el('div', mine ? 'bubble me' : 'bubble', [el('p', 'who', who), ...body]);
  }

  const text = (value: string) => el('p', 'chat-text', [value]);

  // A question answered with "Something else": the next Send is its answer.
  let ownAnswer: { id: string; done(): void; failed(reason: string): void } | undefined;

  function questionBubble(id: string, questions: ChatQuestionItem[]): HTMLElement {
    const oneClick = questions.length === 1 && !questions[0].multiSelect;
    const picks = new Map<string, string[]>(questions.map(({ question }) => [question, []]));
    const optionButtons: HTMLButtonElement[] = [];
    const problem = el('div', '');

    const finish = (chosen: HTMLButtonElement[]) => {
      optionButtons.forEach((option) => {
        option.disabled = true;
      });
      chosen.forEach((option) => option.setAttribute('aria-pressed', 'true'));
      sendAnswers.disabled = true;
      if (ownAnswer?.id === id) {
        ownAnswer = undefined;
        input.placeholder = BOX_PLACEHOLDER;
      }
    };
    const fail = (reason: string) => problem.replaceChildren(errorNote(`The answer was not sent: ${reason}`));

    async function answer(option: ChatAnswer, chosen: HTMLButtonElement[]): Promise<void> {
      optionButtons.forEach((each) => {
        each.disabled = true;
      });
      const result = await act(() => grillo.invoke('agent-chat:answer', { id, option }));
      if (result.ok) {
        finish(chosen);
        return;
      }
      optionButtons.forEach((each) => {
        each.disabled = false;
      });
      fail(result.reason);
    }

    const sendAnswers = button('Send answers', {
      small: true,
      variant: 'primary',
      disabled: true,
      onClick: () => {
        const joined = Object.fromEntries([...picks].map(([question, labels]) => [question, labels.join(PICK_SEPARATOR)]));
        const option: ChatAnswer = questions.length === 1 ? joined[questions[0].question] : joined;
        void answer(option, optionButtons.filter((each) => each.getAttribute('aria-pressed') === 'true'));
      },
    });

    function optionButton(label: string, description: string, onClick: (self: HTMLButtonElement) => void) {
      const option = el('button', 'opt', [el('span', 'strong', [label]), el('span', 'small', [description])]);
      option.type = 'button';
      option.setAttribute('aria-pressed', 'false');
      option.addEventListener('click', () => onClick(option));
      optionButtons.push(option);
      return option;
    }

    const blocks = questions.flatMap(({ question, options, multiSelect }) => {
      const choices = options.map(({ label, description }) =>
        optionButton(label, description, (self) => {
          if (oneClick) {
            void answer(label, [self]);
            return;
          }
          const picked = picks.get(question) ?? [];
          const siblings = optionButtons.filter((each) => each.dataset['question'] === question);
          const next = picked.includes(label)
            ? picked.filter((each) => each !== label)
            : multiSelect
              ? [...picked, label]
              : [label];
          picks.set(question, next);
          siblings.forEach((each) => each.setAttribute('aria-pressed', String(next.includes(each.dataset['label'] ?? ''))));
          sendAnswers.disabled = [...picks.values()].some((labels) => labels.length === 0);
        }),
      );
      choices.forEach((choice, at) => {
        choice.dataset['question'] = question;
        choice.dataset['label'] = options[at].label;
      });
      if (oneClick) {
        choices.push(
          optionButton(SOMETHING_ELSE, SOMETHING_ELSE_HINT, (self) => {
            ownAnswer = { id, done: () => finish([self]), failed: fail };
            input.placeholder = OWN_ANSWER_PLACEHOLDER;
            input.focus();
          }),
        );
      }
      return [text(question), el('div', 'options', choices)];
    });

    return bubble([name], [...blocks, ...(oneClick ? [] : [el('div', 'row', [sendAnswers])]), problem]);
  }

  function permissionBubble(id: string, toolName: string, input: Record<string, unknown>, description: string) {
    const outcome = el('div', '');
    const decide = async (channel: 'agent-chat:allow' | 'agent-chat:deny', done: string) => {
      allow.disabled = true;
      deny.disabled = true;
      const result = await act(() => grillo.invoke(channel, { id }));
      if (result.ok) {
        outcome.replaceChildren(el('p', 'small muted', [done]));
        return;
      }
      allow.disabled = false;
      deny.disabled = false;
      outcome.replaceChildren(errorNote(`Not sent: ${result.reason}`));
    };
    const allow = button('Allow', { small: true, variant: 'primary', onClick: () => void decide('agent-chat:allow', 'Allowed.') });
    const deny = button('Deny', { small: true, onClick: () => void decide('agent-chat:deny', 'Denied.') });
    return bubble(
      [name, badge('Asks permission', 'warn')],
      [
        el('p', 'chat-text', [`${toolName}: `, el('code', '', [toolSummary(input)])]),
        ...(description !== '' ? [el('p', 'small muted', [description])] : []),
        el('div', 'row', [allow, deny]),
        outcome,
      ],
    );
  }

  function render(message: ChatMessage): HTMLElement | undefined {
    switch (message.type) {
      case 'assistant':
        return bubble([name], [text(message.text)]);
      case 'user':
        return bubble([MEMBER], [text(message.text)], true);
      case 'question':
        return questionBubble(message.id, message.questions);
      case 'permission':
        return permissionBubble(message.id, message.toolName, message.input, message.description);
      case 'result':
        return message.isError ? errorNote(`The agent's turn ended with an error: ${message.text}`) : undefined;
      case 'error':
        return errorNote(message.message);
      case 'init':
        return undefined;
    }
  }

  /** The raw lines on screen, oldest first, trimmed to the log's cap so a long run never grows the tab. */
  const rawLines: HTMLElement[] = [];
  function addRaw(line: string): void {
    const node = el('span', ['raw-line', rawTone(line)].filter(Boolean).join(' '), [line]);
    terminal.append(node, '\n');
    rawLines.push(node);
    if (rawLines.length > MAX_RAW_LINES) {
      const oldest = rawLines.shift();
      oldest?.nextSibling?.remove();
      oldest?.remove();
    }
    if (!terminal.hidden) terminal.scrollTop = terminal.scrollHeight;
  }

  stops.push(
    log.follow(agent.id, {
      message: (message) => {
        const node = render(message);
        if (node) show(node);
      },
      raw: addRaw,
    }),
  );

  /**
   * The live transcript words the session holds for this agent, as last put into the box. The box stays the
   * member's: new words are added to the end of whatever it holds, and Send sends all of it as one message.
   */
  let shownHeld = '';
  const shownText = (words: string) => words.replace(LINE_BREAKS, ' ').trim();
  const joined = (...parts: string[]) => parts.filter((part) => part !== '').join(' ');

  function setShownHeld(words: string): void {
    shownHeld = words;
    hint.hidden = words === '';
    send.classList.toggle('primary', words === '');
  }

  function hold(words: string): void {
    if (words.startsWith(shownHeld)) {
      input.value = joined(input.value, shownText(words.slice(shownHeld.length)));
    } else {
      // The held words went out another way (the meeting's Use it): they leave the box, the member's text stays.
      input.value = joined(input.value.replace(shownText(shownHeld), '').trim(), shownText(words));
    }
    setShownHeld(words);
  }

  stops.push(
    grillo.on('session:held', (payload: unknown) => {
      const { agentId, text: words } = (payload ?? {}) as { agentId?: unknown; text?: unknown };
      if (agentId === agent.id && typeof words === 'string') hold(words);
    }),
  );

  const session = createSessionClient(grillo);
  function showChannel(): void {
    session.channels().then(
      (open) => {
        if (!disposed) channelBadge.hidden = !open.includes(agent.id);
      },
      () => undefined,
    );
  }
  stops.push(grillo.on('session:changed', showChannel));
  showChannel();

  /** Sends the box through the session when it holds transcript words, so they are never held and sent again. */
  async function sendWithHeld(value: string, shown: string): Promise<ChatActionResult> {
    try {
      await session.sendBox(agent.id, value, shown);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: messageOf(error) };
    }
  }

  async function sendBox(): Promise<void> {
    const value = input.value;
    if (value.trim() === '') return;
    const target = ownAnswer;
    const shown = shownHeld;
    // The box empties at once: words spoken while the message is on its way land in an empty box.
    input.value = '';
    if (!target) setShownHeld('');
    send.disabled = true;
    const result = target
      ? await act(() => grillo.invoke('agent-chat:answer', { id: target.id, option: value }))
      : shown !== ''
        ? await sendWithHeld(value, shown)
        : await act(() => grillo.invoke('agent-chat:send', { id: agent.id, text: value }));
    send.disabled = false;
    if (!result.ok) {
      input.value = joined(value, input.value);
      if (target) target.failed(result.reason);
      else show(errorNote(`Not sent: ${result.reason}`));
      return;
    }
    if (target) {
      target.done();
      show(bubble([MEMBER], [text(value)], true));
    }
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      void sendBox();
    }
  });

  return {
    shown() {
      msgs.scrollTop = msgs.scrollHeight;
      if (terminalToggle.checked) terminal.scrollTop = terminal.scrollHeight;
      input.focus();
    },
    setInput(value) {
      input.value = value;
    },
    dispose() {
      disposed = true;
      stops.forEach((stop) => stop());
      log.forget(agent.id);
    },
  };
}

/** The chat view as a body panel for every agent kind; a terminal agent's tab gets the terminal instead. */
export function chatViewPanel(options: ChatViewOptions = {}): TabPanel {
  const terminal = options.terminal ?? terminalPanel();
  const logFor = options.log ?? appChatLog;
  return {
    kinds: 'all',
    slot: 'body',
    priority: CHAT_VIEW_PRIORITY,
    mount(el, context) {
      if (context.agent.runtime !== 'chat') return terminal.mount(el, context);
      return mountChatView(el, context, logFor(context.grillo));
    },
  };
}
