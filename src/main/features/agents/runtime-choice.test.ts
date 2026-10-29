import { describe, expect, it, vi } from 'vitest';
import { agentRuntimeChoice, AGENT_RUNTIME_VARIABLE, DEFAULT_AGENT_RUNTIME } from './runtime-choice';

describe('agent runtime choice', () => {
  it('is the terminal agent when nothing is set, until the chat view lands', () => {
    expect(DEFAULT_AGENT_RUNTIME).toBe('terminal');
    expect(agentRuntimeChoice({}, vi.fn())).toBe('terminal');
  });

  it.each([
    ['terminal', 'terminal'],
    ['chat', 'chat'],
    [' Terminal ', 'terminal'],
  ])('follows %j in the environment variable', (value, choice) => {
    expect(agentRuntimeChoice({ [AGENT_RUNTIME_VARIABLE]: value }, vi.fn())).toBe(choice);
  });

  it.each(['', 'termnial', 'pty'])('keeps the default for an unknown value %j, and says so', (value) => {
    const warn = vi.fn();

    expect(agentRuntimeChoice({ [AGENT_RUNTIME_VARIABLE]: value }, warn)).toBe('terminal');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(AGENT_RUNTIME_VARIABLE));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the terminal runtime'));
  });
});
