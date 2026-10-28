/**
 * Small DOM parts of the project screen, with the prototype's class names (styled by project-creation.css).
 */
import { button } from '../../theme/components';

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

export type NoteTone = 'info' | 'ok' | 'warn' | 'err';

/** A message in a tinted band, as the prototype's `.note`. */
export function note(text: string, tone: NoteTone = 'info'): HTMLParagraphElement {
  const element = el('p', tone === 'info' ? 'note small' : `note small ${tone}`, [text]);
  if (tone === 'err') element.setAttribute('role', 'alert');
  return element;
}

/** The text of any refusal, to show the member. */
export function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : String(error);
}

/** A labelled control, as the prototype's `.field`. */
export function field(label: string, control: HTMLElement): HTMLLabelElement {
  return el('label', 'field', [label, control]);
}

export interface TextInputOptions {
  value: string;
  label?: string;
  placeholder?: string;
  type?: 'text' | 'search';
  disabled?: boolean;
  onInput?: (value: string) => void;
}

/** A one-line text field; typing calls `onInput` and never redraws, so focus stays where it is. */
export function textInput(options: TextInputOptions): HTMLInputElement {
  const input = document.createElement('input');
  input.type = options.type ?? 'text';
  input.value = options.value;
  input.disabled = options.disabled ?? false;
  if (options.label) input.setAttribute('aria-label', options.label);
  if (options.placeholder) input.placeholder = options.placeholder;
  const { onInput } = options;
  if (onInput) input.addEventListener('input', () => onInput(input.value));
  return input;
}

/** A segmented choice, as the prototype's `.seg`: the pressed option is the current one. */
export function segmented<T extends string>(
  label: string,
  options: ReadonlyArray<{ value: T; text: string }>,
  current: T,
  onPick: (value: T) => void,
  disabled = false,
): HTMLDivElement {
  const group = el('div', 'seg');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const option of options) {
    const choice = el('button', '', [option.text]);
    choice.type = 'button';
    choice.disabled = disabled;
    choice.setAttribute('aria-pressed', String(option.value === current));
    choice.addEventListener('click', () => {
      if (option.value !== current) onPick(option.value);
    });
    group.append(choice);
  }
  return group;
}

const TAG_COLOURS = 4;

/** The same domain always gets the same of the four tag colours. */
function tagColour(domain: string): string {
  let hash = 0;
  for (const char of domain) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % TAG_COLOURS;
  return `d${hash + 1}`;
}

/** A domain or file tag; with `onRemove` it carries a "×" that removes it. */
export function tag(text: string, onRemove?: () => void, tone?: 'none'): HTMLSpanElement {
  const element = el('span', `tag ${tone ?? tagColour(text)}`, [text]);
  if (onRemove) {
    const remove = el('button', 'tag-remove', ['×']);
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${text}`);
    remove.addEventListener('click', onRemove);
    element.append(remove);
  }
  return element;
}

/** A hidden file picker opened by a visible button; `onFiles` gets the picked files. */
export function filePicker(
  label: string,
  options: { accept: string; multiple: boolean; disabled: boolean; onFiles: (files: File[]) => void },
): HTMLElement[] {
  const input = document.createElement('input');
  input.type = 'file';
  input.className = 'file-input';
  input.accept = options.accept;
  input.multiple = options.multiple;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => {
    options.onFiles([...(input.files ?? [])]);
    input.value = '';
  });
  const open = button(label, { small: true, disabled: options.disabled, onClick: () => input.click() });
  return [open, input];
}
