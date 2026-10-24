import { describe, expect, it } from 'vitest';
import { agentTitle } from './agents';

describe('agentTitle', () => {
  it('names a tab "<kind> · <ticket>" with the kind capitalised', () => {
    expect(agentTitle('grilling', 'Login flow')).toBe('Grilling · Login flow');
  });
});
