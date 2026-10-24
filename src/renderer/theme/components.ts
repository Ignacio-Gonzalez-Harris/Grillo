/**
 * The liquid glass components: thin DOM helpers that only build elements and set the class names glass.css styles.
 * They hold no colour or spacing of their own; every value comes from the tokens through glass.css.
 */
import './glass.css';

export type BadgeTone = 'ok' | 'warn' | 'err' | 'info';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classes: Array<string | false | undefined>,
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = classes.filter(Boolean).join(' ');
  el.append(...children);
  return el;
}

/** A frosted glass panel; `raised` gives the stronger fill and blur of pop-overs and the active tab. */
export function glassPanel(children: Array<Node | string>, options: { raised?: boolean } = {}): HTMLDivElement {
  return element('div', ['glass', options.raised && 'glass-strong'], children);
}

export interface ButtonOptions {
  variant?: 'primary' | 'danger';
  small?: boolean;
  disabled?: boolean;
  onClick?: (event: MouseEvent) => void;
}

/** A pill button: plain, `primary` (the main action) or `danger`. */
export function button(label: string, options: ButtonOptions = {}): HTMLButtonElement {
  const el = element('button', ['btn', options.variant, options.small && 'sm'], [label]);
  el.type = 'button';
  el.disabled = options.disabled ?? false;
  if (options.onClick) el.addEventListener('click', options.onClick);
  return el;
}

export interface ToggleOptions {
  checked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

/** A labelled on/off switch; `root` is the label to place, `input` the checkbox inside it. */
export function toggle(label: string, options: ToggleOptions = {}): { root: HTMLLabelElement; input: HTMLInputElement } {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = options.checked ?? false;
  input.disabled = options.disabled ?? false;
  const { onChange } = options;
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return { root: element('label', ['switch'], [input, label]), input };
}

/** A list of rows separated by hairlines, one row per item. */
export function list(items: Array<Node | string>): HTMLUListElement {
  return element(
    'ul',
    ['rows'],
    items.map((item) => element('li', [], [item])),
  );
}

/** A small pill label; the tone colours it as success, warning, error or information. */
export function badge(text: string, tone?: BadgeTone): HTMLSpanElement {
  return element('span', ['badge', tone], [text]);
}

export interface DialogOptions {
  title: string;
  body: Array<Node | string>;
  /** Buttons, shown on the right in the order given (the main action last). */
  actions: HTMLElement[];
}

/** A raised glass card that asks for something, as the prototype's dialogs: title, body, then the actions. */
export function dialog(options: DialogOptions): HTMLDivElement {
  const actions = element('div', ['row'], [element('span', ['spacer']), ...options.actions]);
  const el = element('div', ['card', 'glass-strong', 'stack'], [element('h4', [], [options.title]), ...options.body, actions]);
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', options.title);
  return el;
}
