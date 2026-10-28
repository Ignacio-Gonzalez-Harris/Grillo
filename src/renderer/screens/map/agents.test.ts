import { describe, expect, it } from 'vitest';
import { readCommandCatalogue } from '../../../../resources/skills/catalogue';
import { PRD_COMMAND, TAGGING_COMMAND } from './agents';

describe('the map screen’s agents', () => {
  it('type the commands the catalogue lists for the tagging round and the PRD writer, as grilling agents', async () => {
    const catalogue = await readCommandCatalogue();
    for (const command of [TAGGING_COMMAND, PRD_COMMAND]) {
      expect(catalogue.find((entry) => entry.command === command)?.kind).toBe('grilling');
    }
  });
});
