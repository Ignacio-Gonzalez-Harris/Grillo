/** Small DOM builders for the setup check; the class names are the prototype's, styled by setup-check.css. */

export type Content = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  children: Content[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.append(...children);
  return element;
}

/** A command or a tool name, set in the code font. */
export function code(text: string): HTMLElement {
  return el('code', '', [text]);
}

/** Several nodes placed together, such as the two sides of a list row. */
export function fragment(children: Content[]): DocumentFragment {
  const parts = document.createDocumentFragment();
  parts.append(...children);
  return parts;
}

export type DotTone = 'ok' | 'err' | 'neutral';

/** The status dot in front of a requirement. */
export function statusDot(tone: DotTone): HTMLSpanElement {
  return el('span', tone === 'neutral' ? 'sdot' : `sdot ${tone}`);
}
