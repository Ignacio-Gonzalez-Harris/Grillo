import type { ChatActionResult, ChatAgentId } from '../../../shared/agent-chat';
import type { ChatDriver } from './driver';

const WHITESPACE_RUN = /\s+/g;

/**
 * The member's name as it may stand inside the prefix: one line (line breaks and tabs become single spaces) and no
 * square brackets (they become round ones), so the prefix always closes exactly once and no name can fake the end
 * of it.
 */
function prefixName(member: string): string {
  return member.replace(WHITESPACE_RUN, ' ').trim().replace(/\[/g, '(').replace(/\]/g, ')');
}

/**
 * The support agent's relay (PRD section 4.6 item 7): one ordinary user message in the target agent's own chat,
 * marked `[from Support, for <member>]`. Agents share nothing else; the reply arrives in the target's stream.
 */
export function relay(driver: ChatDriver, targetAgentId: ChatAgentId, member: string, text: string): ChatActionResult {
  if (typeof member !== 'string' || prefixName(member) === '') {
    return { ok: false, reason: 'A relay needs the name of the member it is for' };
  }
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'A relay needs a message' };
  }
  return driver.send(targetAgentId, `[from Support, for ${prefixName(member)}] ${text}`);
}
