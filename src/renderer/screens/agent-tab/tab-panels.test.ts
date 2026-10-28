import { describe, expect, it } from 'vitest';
import { loadTabPanels, registerTabPanels, type TabPanel } from './tab-panels';

const mount = () => undefined;
const terminal: TabPanel = { kinds: 'all', slot: 'body', priority: 0, mount };
const at = (folder: string) => `/src/renderer/screens/${folder}/tab-panel.ts`;
const panel = (overrides: Partial<TabPanel>): TabPanel => ({ kinds: 'all', slot: 'controls', priority: 1, mount, ...overrides });

describe('tab-panel discovery', () => {
  // In tests the `@screens` folder points at src/renderer/app/__fixtures__/screens (see vitest.config.mts), so the
  // real discovery code finds the fixture's tab-panel.ts exactly as the app finds src/renderer/screens/*/tab-panel.ts.
  it('finds the panels of a tab-panel.ts that no shared file names', () => {
    const panels = loadTabPanels([terminal]);

    expect(panels.panelsFor('grilling', 'controls')).toHaveLength(1);
    expect(panels.panelsFor('generic', 'controls')).toEqual([]);
    expect(panels.panelsFor('research', 'header')).toHaveLength(1);
    expect(panels.bodyFor('grilling')).toBe(terminal);
  });

  it('takes one panel or an array of panels, by kind and slot, highest priority first and ties in folder order', () => {
    const low = panel({ priority: -1 });
    const early = panel({ kinds: ['grilling', 'generic'] });
    const late = panel({});
    const header = panel({ slot: 'header', kinds: ['support'] });

    const panels = registerTabPanels({ [at('zeta')]: { default: [late, header] }, [at('alpha')]: { default: early }, [at('mid')]: { default: low } }, [terminal]);

    expect(panels.panelsFor('grilling', 'controls')).toEqual([early, late, low]);
    expect(panels.panelsFor('task', 'controls')).toEqual([late, low]);
    expect(panels.panelsFor('support', 'header')).toEqual([header]);
    expect(panels.panelsFor('task', 'header')).toEqual([]);
  });

  it('shows the built-in terminal as the body unless a higher-priority body serves the kind, as the chat view will', () => {
    const chat = panel({ slot: 'body', kinds: ['grilling'], priority: 10 });
    const lower = panel({ slot: 'body', priority: -5 });

    const panels = registerTabPanels({ [at('chat')]: { default: chat }, [at('lower')]: { default: lower } }, [terminal]);

    expect(panels.bodyFor('grilling')).toBe(chat);
    expect(panels.bodyFor('generic')).toBe(terminal);
  });

  it('refuses two body panels that tie for a kind, naming both, and a kind no body serves', () => {
    const tie = panel({ slot: 'body', kinds: ['task'], priority: 0 });

    expect(() => registerTabPanels({ [at('chat')]: { default: tie } }, [terminal])).toThrow(
      "Body panels built in and 'chat' both serve 'task' agents at priority 0",
    );
    expect(() => registerTabPanels({}, [])).toThrow("No body panel serves 'grilling' agents");
  });

  it.each([
    ['nothing at all', null],
    ['no default export', { panel: panel({}) }],
    ['a default that is not an object', { default: 'panel' }],
    ['an empty array', { default: [] }],
    ['an array with one broken panel', { default: [panel({}), { ...panel({}), mount: undefined }] }],
    ['kinds that are neither "all" nor a list', { default: { ...panel({}), kinds: 'grilling' } }],
    ['an empty kinds list', { default: panel({ kinds: [] }) }],
    ['an unknown kind', { default: { ...panel({}), kinds: ['grilling', 'wizard'] } }],
    ['a kind listed twice', { default: panel({ kinds: ['task', 'task'] }) }],
    ['an unknown slot', { default: { ...panel({}), slot: 'footer' } }],
    ['a priority that is text', { default: { ...panel({}), priority: '1' } }],
    ['a priority that is not finite', { default: panel({ priority: Number.POSITIVE_INFINITY }) }],
    ['a priority that is not a number', { default: panel({ priority: Number.NaN }) }],
    ['a mount that is not a function', { default: { ...panel({}), mount: 'later' } }],
  ])('names the folder whose tab-panel.ts exports %s', (_case, module) => {
    expect(() => registerTabPanels({ [at('broken')]: module }, [terminal])).toThrow(
      "Folder 'broken' must export as default from its tab-panel.ts a panel or a non-empty array of panels",
    );
  });

  it('refuses a module path that is not <screen>/tab-panel.ts', () => {
    expect(() => registerTabPanels({ '/src/renderer/screens/odd/panel.ts': { default: panel({}) } }, [terminal])).toThrow(
      "Tab panel module path '/src/renderer/screens/odd/panel.ts' does not end in <screen>/tab-panel.ts",
    );
  });
});
