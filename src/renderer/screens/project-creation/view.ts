/**
 * Small DOM parts of the project screen, with the prototype's class names (styled by project-creation.css).
 */
import { button } from '../../theme/components';
import { FORM_STEPS, STEP_NAMES, type FormStep } from './form';

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

/** Why a control stops the member, shown right beside it; `dropReason` takes it away as soon as the control changes. */
export function reasonNote(text: string): HTMLParagraphElement {
  const element = note(text, 'err');
  element.dataset['reason'] = '';
  return element;
}

export function dropReason(scope: ParentNode): void {
  scope.querySelector('[data-reason]')?.remove();
}

/** The title and the plain-words line every page of this screen opens with. */
export function pageHead(title: string, lead: string, badge?: HTMLElement): HTMLDivElement {
  const heading = el('h3', '', [title]);
  return el('div', 'page-head', [badge ? el('div', 'row', [heading, badge]) : heading, el('p', '', [lead])]);
}

/** Which step of four this is, or the review page once all four are done. */
export function stepProgress(current: FormStep | 'review'): HTMLDivElement {
  const at = current === 'review' ? FORM_STEPS.length : FORM_STEPS.indexOf(current);
  const steps = el(
    'ol',
    'stepper',
    FORM_STEPS.map((step, index) => {
      const item = el('li', index < at ? 'done' : '', [STEP_NAMES[step]]);
      if (index === at) item.setAttribute('aria-current', 'step');
      return item;
    }),
  );
  steps.setAttribute('aria-label', 'Steps');
  const line = current === 'review' ? 'Last check before Grillo starts' : `Step ${at + 1} of ${FORM_STEPS.length}`;
  return el('div', 'step-progress', [el('p', 'small muted m0', [line]), steps]);
}

/** The buttons under a page, pushed to the right; `leading` ones stay at the left. */
export function pageActions(trailing: HTMLElement[], leading: HTMLElement[] = []): HTMLDivElement {
  return el('div', 'row page-actions', [...leading, el('span', 'spacer'), ...trailing]);
}

/** What Electron puts in front of an error thrown in the main process; it means nothing to the member. */
const IPC_WRAPPING = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

/** A refusal's text as the member should read it: the reason alone. */
export function plainReason(text: string): string {
  return text.replace(IPC_WRAPPING, '');
}

/** The text of any refusal, to show the member. */
export function messageOf(error: unknown): string {
  return plainReason(error instanceof Error && error.message !== '' ? error.message : String(error));
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
