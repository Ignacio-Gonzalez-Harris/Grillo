// A fixture tab-panel module: the tab-panel discovery tests find it through the `@screens` alias, which
// vitest.config.mts points here, exactly as the app finds src/renderer/screens/*/tab-panel.ts.
import type { TabPanel } from '../../../../screens/agent-tab/tab-panels';

const panels: TabPanel[] = [
  {
    kinds: ['grilling'],
    slot: 'controls',
    priority: 1,
    mount(el) {
      el.textContent = 'Fixture controls';
    },
  },
  {
    kinds: 'all',
    slot: 'header',
    priority: 1,
    mount(el) {
      el.textContent = 'Fixture header';
    },
  },
];

export default panels;
