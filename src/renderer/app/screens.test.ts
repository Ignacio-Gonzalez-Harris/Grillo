import { describe, expect, it } from 'vitest';
import { loadScreens, registerScreens } from './screens';

const mount = () => undefined;

describe('screen discovery', () => {
  // In tests the `@screens` folder points at src/renderer/app/__fixtures__/screens (see vitest.config.mts),
  // so the real discovery code finds the fixture screen exactly as the app finds src/renderer/screens/*.
  it('registers a screen folder that no shared file names', () => {
    const screens = loadScreens();

    expect([...screens.keys()]).toEqual(['fixture-hello']);
    expect(screens.get('fixture-hello')?.title).toBe('Fixture hello');
  });

  it.each([
    ['no id', { title: 'T', mount }],
    ['an empty id', { id: '', title: 'T', mount }],
    ['no title', { id: 'x', mount }],
    ['no mount function', { id: 'x', title: 'T', mount: 'not a function' }],
    ['a start that is not a function', { id: 'x', title: 'T', mount, start: 'soon' }],
    ['nothing at all', null],
  ])('names the folder whose index.ts exports %s', (_case, module) => {
    expect(() => registerScreens({ '/src/renderer/screens/broken/index.ts': module })).toThrow(
      "Screen folder 'broken' must export id, title and mount(el, params) from its index.ts",
    );
  });

  it('refuses two folders that claim the same screen id, naming both', () => {
    const modules = {
      '/src/renderer/screens/one/index.ts': { id: 'same', title: 'One', mount },
      '/src/renderer/screens/two/index.ts': { id: 'same', title: 'Two', mount },
    };

    expect(() => registerScreens(modules)).toThrow("Screen id 'same' is registered by both 'one' and 'two'");
  });
});
