import { AGENT_RUNTIME_CHOICES, type AgentRuntimeChoice } from '../../../shared/agents';

/**
 * The one place the agent runtime is chosen (issue 156). The terminal by default, even with the chat view in place
 * (issue 94): the chat view is opt-in until the terms check (issue 123) confirms that Anthropic allows the
 * machine-readable mode with members' own subscriptions (PRD section 8, Agent runtime; owner's decision, 2026-10-29).
 */
export const DEFAULT_AGENT_RUNTIME: AgentRuntimeChoice = 'terminal';
/** Set to `terminal` (or `chat`) before starting Grillo to pick the runtime for every agent tab. */
export const AGENT_RUNTIME_VARIABLE = 'GRILLO_AGENT_RUNTIME';

function isChoice(value: string): value is AgentRuntimeChoice {
  return (AGENT_RUNTIME_CHOICES as readonly string[]).includes(value);
}

/** The runtime every agent tab uses. An unknown value keeps the default, with a warning naming the variable. */
export function agentRuntimeChoice(
  env: Record<string, string | undefined>,
  warn: (message: string) => void,
): AgentRuntimeChoice {
  const value = env[AGENT_RUNTIME_VARIABLE];
  if (value === undefined) return DEFAULT_AGENT_RUNTIME;
  const wanted = value.trim().toLowerCase();
  if (isChoice(wanted)) return wanted;
  warn(
    `${AGENT_RUNTIME_VARIABLE} is '${value}', which is neither ${AGENT_RUNTIME_CHOICES.join(' nor ')}: ` +
      `agents use the ${DEFAULT_AGENT_RUNTIME} runtime.`,
  );
  return DEFAULT_AGENT_RUNTIME;
}
