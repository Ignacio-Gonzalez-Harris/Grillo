/**
 * The support agent tab's half of the relay (PRD section 4.6 item 7; `resources/skills/grillo-support/SKILL.md`,
 * "The relay request" and "Grillo's answer to a relay request"). Every message a running support agent writes is read
 * for `grillo-relay` blocks; each good one is posted into the named agent tab's chat through the agent chat protocol's
 * relay, marked for the member, and the support agent is told the outcome in one line: `relayed: <tab name>` or
 * `not relayed: <reason>`. Requests are answered one at a time, in the order the agent wrote them.
 *
 * Only chat agents write chat messages, so a relay works where the agent tabs run as chat agents; with the terminal
 * runtime nothing is read and nothing is posted.
 */
import { readRelayRequests, type RelayRequest } from '../../../../resources/skills/grillo-support/relay-request';
import type { ChatMessage } from '../../../shared/agent-chat';
import type { AgentId, AgentInfo } from '../../../shared/agents';
import type { GrilloApi, Unsubscribe } from '../../../shared/ipc';
import type { IdentityResult } from '../../../shared/tools';
import type { ShellContext } from '../../app/screens';
import { messageOf } from '../own-time/view';

const WHITESPACE_RUN = /\s+/g;
const oneLine = (text: string) => text.replace(WHITESPACE_RUN, ' ').trim();

const relayed = (tab: string) => `relayed: ${tab}`;
const notRelayed = (reason: string) => `not relayed: ${oneLine(reason)}`;

/** The text of an assistant message, or undefined for anything else the event could carry. */
function assistantText(payload: unknown): { id: AgentId; text: unknown } | undefined {
  const event = payload as { id?: unknown; message?: Partial<ChatMessage> | null } | null;
  if (typeof event?.id !== 'string' || event.message?.type !== 'assistant') return undefined;
  return { id: event.id, text: (event.message as { text?: unknown }).text };
}

/** Starts reading every support agent's messages for relay requests; returns the function that stops it. */
export function watchRelays(grillo: GrilloApi, shell: ShellContext): Unsubscribe {
  let agents: readonly AgentInfo[] = [];
  const stopFollowing = shell.onAgentTabs((list) => {
    agents = list;
  });
  /** Each support agent's answers in flight, so they reach it in the order its requests were written. */
  const queues = new Map<AgentId, Promise<void>>();

  async function member(): Promise<string> {
    const result: Partial<IdentityResult> | null = await grillo.invoke('tools:identity', undefined);
    const login: unknown = result?.ok === true ? result.identity?.login : undefined;
    if (typeof login !== 'string' || login.trim() === '') {
      const reason = result?.ok === false ? result.reason : 'failed';
      throw new Error(`Grillo could not read your GitHub login (${reason}); sign in with gh and ask again`);
    }
    return login;
  }

  async function answerTo(request: RelayRequest): Promise<string> {
    if (!request.ok) return notRelayed(request.reason);
    const to = oneLine(request.to);
    const named = agents.filter((agent) => oneLine(agent.title) === to);
    if (named.some((agent) => agent.kind === 'support')) {
      return notRelayed('The target is the support tab itself; name another agent tab');
    }
    if (named.length !== 1) {
      const open = agents.filter((agent) => agent.kind !== 'support').map((agent) => agent.title);
      const problem = named.length === 0 ? `No open agent tab is named '${to}'` : `${named.length} open tabs are named '${to}'`;
      return notRelayed(`${problem}. Open tabs: ${open.length > 0 ? open.join(', ') : 'none'}`);
    }
    const [target] = named;
    try {
      const result = await grillo.invoke('agent-chat:relay', {
        targetAgentId: target.id,
        member: await member(),
        text: request.text,
      });
      return result.ok ? relayed(target.title) : notRelayed(result.reason);
    } catch (error) {
      return notRelayed(messageOf(error));
    }
  }

  async function answerAll(supportId: AgentId, requests: readonly RelayRequest[]): Promise<void> {
    for (const request of requests) {
      const answer = await answerTo(request);
      try {
        await grillo.invoke('agents:send', { id: supportId, text: answer });
      } catch (error) {
        console.warn(`Grillo could not tell the support agent '${answer}'.`, error);
      }
    }
  }

  const stopListening = grillo.on('agent-chat:message', (payload) => {
    const said = assistantText(payload);
    if (!said || !agents.some((agent) => agent.id === said.id && agent.kind === 'support')) return;
    const requests = readRelayRequests(said.text);
    if (requests.length === 0) return;
    const before = queues.get(said.id) ?? Promise.resolve();
    const done = before.then(() => answerAll(said.id, requests));
    queues.set(said.id, done);
    void done.finally(() => {
      if (queues.get(said.id) === done) queues.delete(said.id);
    });
  });

  return () => {
    stopListening();
    stopFollowing();
    queues.clear();
  };
}
