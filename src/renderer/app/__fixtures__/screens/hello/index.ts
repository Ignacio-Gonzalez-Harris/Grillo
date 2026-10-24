// A fixture screen: the discovery tests find it through the `@screens` alias, which vitest.config.mts points here.
import type { ScreenParams } from '../../../screens';

export const id = 'fixture-hello';
export const title = 'Fixture hello';

export function mount(el: HTMLElement, params: ScreenParams): () => void {
  el.textContent = `Hello ${params['name'] ?? 'nobody'}`;
  return () => {
    el.dataset['unmounted'] = 'yes';
  };
}
