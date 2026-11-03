// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { badge, button, dialog, glassPanel, list, toggle } from './components';

describe('the shared control theme: every form control in the app takes its look from glass.css', () => {
  const NAMED_TEXT_INPUT_TYPES = ['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'];

  function loadStylesheet(pathFromRenderer: string): void {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(__dirname, '..', pathFromRenderer), 'utf8');
    document.head.append(style);
  }

  beforeAll(() => {
    loadStylesheet('theme/tokens.css');
    loadStylesheet('theme/glass.css');
    loadStylesheet('screens/own-time/own-time.css');
    loadStylesheet('screens/chat-view/chat-view.css');
    loadStylesheet('components/terminal/terminal.css');
  });

  function token(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function placed<T extends HTMLElement>(control: T, parent: HTMLElement = document.body): T {
    parent.append(control);
    return control;
  }

  function inputOfType(type: string | null): HTMLInputElement {
    const input = document.createElement('input');
    if (type !== null) input.setAttribute('type', type);
    return placed(input);
  }

  /** A text input in a screen's own nesting of class names, so that screen's own rule applies to it as well. */
  function inputInside(...classNames: string[]): HTMLInputElement {
    const parent = classNames.reduce((outer, className) => {
      const inner = placed(document.createElement('div'), outer);
      inner.className = className;
      return inner;
    }, document.body);
    return placed(document.createElement('input'), parent);
  }

  const FIELDS: Array<[string, () => HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement]> = [
    ['an input with no type', () => inputOfType(null)],
    ...NAMED_TEXT_INPUT_TYPES.map((type): [string, () => HTMLInputElement] => [`an input of type ${type}`, () => inputOfType(type)]),
    ['a text area', () => placed(document.createElement('textarea'))],
    ['a dropdown', () => placed(document.createElement('select'))],
    ['the terminal type box', () => inputInside('typebox')],
    ['the chat message box', () => inputInside('chat-view', 'msgbox')],
  ];

  it.each(FIELDS)('themes %s in its normal, focus and disabled states', (_name, build) => {
    const field = build();

    expect(getComputedStyle(field).backgroundColor).toBe(token('--color-input-fill'));
    expect(getComputedStyle(field).borderColor).toBe(token('--color-input-border'));
    expect(getComputedStyle(field).color).toBe(token('--color-text'));

    field.disabled = true;
    expect(getComputedStyle(field).backgroundColor).toBe(token('--color-disabled-fill'));
    expect(getComputedStyle(field).color).toBe(token('--color-text-disabled'));

    const focused = build();
    focused.focus();
    expect(getComputedStyle(focused).outlineColor).toBe(token('--color-focus-ring'));
  });

  it("gives a dropdown's open list opaque token colours, so it stays readable over any window", () => {
    const select = placed(document.createElement('select'));
    const open = select.appendChild(document.createElement('option'));
    const off = select.appendChild(document.createElement('option'));
    off.disabled = true;

    expect(getComputedStyle(open).backgroundColor).toBe(token('--color-glass-fill-strong-fallback'));
    expect(getComputedStyle(open).color).toBe(token('--color-text'));
    expect(getComputedStyle(off).color).toBe(token('--color-text-disabled'));
  });

  it.each(['checkbox', 'radio'])('draws a plain %s from tokens when empty, chosen and disabled', (type) => {
    const box = inputOfType(type);

    expect(getComputedStyle(box).appearance).toBe('none');
    expect(getComputedStyle(box).backgroundColor).toBe(token('--color-input-fill'));
    expect(getComputedStyle(box).borderColor).toBe(token('--color-input-border'));

    box.checked = true;
    expect(getComputedStyle(box).backgroundColor).toBe(token('--color-accent'));

    box.disabled = true;
    expect(getComputedStyle(box).backgroundColor).toBe(token('--color-disabled-fill'));
  });

  it('keeps a chosen radio button visible under a system contrast theme, which would paint its dot and fill alike', () => {
    const radio = inputOfType('radio');
    expect(getComputedStyle(radio).getPropertyValue('forced-color-adjust')).toBe('');

    radio.checked = true;
    expect(getComputedStyle(radio).getPropertyValue('forced-color-adjust')).toBe('none');
  });

  it('leaves the toggle with its own look', () => {
    const { root, input } = toggle('Channel');
    document.body.append(root);

    expect(getComputedStyle(input).width).toBe(token('--size-switch-width'));
    expect(getComputedStyle(input).backgroundColor).toBe(token('--color-disabled-fill'));
    // The toggle's own rule sets no text alignment, so any value here means the plain checkbox's rule reached it.
    expect(getComputedStyle(input).verticalAlign).toBe('');

    input.checked = true;
    expect(getComputedStyle(input).backgroundColor).toBe(token('--color-accent'));
  });

  it("leaves the terminal library's own off-screen text area alone", () => {
    const helper = placed(document.createElement('textarea'));
    helper.className = 'xterm-helper-textarea';

    expect(getComputedStyle(helper).minHeight).toBe('');
    expect(getComputedStyle(helper).backgroundColor).toBe('');
  });

  it('themes a visible file control, and leaves a hidden one hidden', () => {
    const visible = inputOfType('file');
    const screen = placed(document.createElement('div'));
    screen.className = 'own-time';
    const hidden = placed(inputOfType('file'), screen);
    hidden.className = 'file-input';

    expect(getComputedStyle(visible).color).toBe(token('--color-text'));
    expect(getComputedStyle(hidden).display).toBe('none');

    visible.disabled = true;
    expect(getComputedStyle(visible).color).toBe(token('--color-text-disabled'));
  });
});

describe('liquid glass components', () => {
  it('builds a glass panel, raised when asked, holding its children', () => {
    const child = document.createElement('p');

    const plain = glassPanel([child]);
    const raised = glassPanel([], { raised: true });

    expect(plain.className).toBe('glass');
    expect(plain.firstChild).toBe(child);
    expect(raised.className).toBe('glass glass-strong');
  });

  it('builds a button in each style that calls back on click and can be disabled', () => {
    const onClick = vi.fn();

    const save = button('Save', { onClick });
    save.click();

    expect(save.type).toBe('button');
    expect(save.textContent).toBe('Save');
    expect(save.className).toBe('btn');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button('Go', { variant: 'primary', small: true }).className).toBe('btn primary sm');
    expect(button('Stop', { variant: 'danger' }).className).toBe('btn danger');
    expect(button('Later', { disabled: true }).disabled).toBe(true);
  });

  it('builds a labelled toggle that reports its new state', () => {
    const onChange = vi.fn();

    const channel = toggle('Channel', { checked: false, onChange });
    document.body.append(channel.root);
    channel.input.click();

    expect(channel.root.className).toBe('switch');
    expect(channel.root.textContent).toBe('Channel');
    expect(channel.input.type).toBe('checkbox');
    expect(onChange).toHaveBeenCalledWith(true);
    expect(toggle('Off', { disabled: true }).input.disabled).toBe(true);
  });

  it('builds a list with one row per item, text or element', () => {
    const element = document.createElement('strong');

    const rows = list(['Sample ticket 1', element]);

    expect(rows.tagName).toBe('UL');
    expect(rows.className).toBe('rows');
    expect([...rows.children].map((li) => li.tagName)).toEqual(['LI', 'LI']);
    expect(rows.children[0].textContent).toBe('Sample ticket 1');
    expect(rows.children[1].firstChild).toBe(element);
  });

  it('builds a badge in each tone', () => {
    expect(badge('grilling').className).toBe('badge');
    expect(badge('Signed in', 'ok').className).toBe('badge ok');
    expect(badge('Signed in', 'ok').textContent).toBe('Signed in');
  });

  it('builds a dialog with its title, body and actions on the right, as the prototype shows', () => {
    const body = document.createElement('p');
    const cancel = button('Cancel');
    const open = button('Open agent', { variant: 'primary' });

    const naming = dialog({ title: 'New generic agent', body: [body], actions: [cancel, open] });

    expect(naming.getAttribute('role')).toBe('dialog');
    expect(naming.getAttribute('aria-label')).toBe('New generic agent');
    expect(naming.className).toBe('card glass-strong stack');
    expect(naming.querySelector('h4')?.textContent).toBe('New generic agent');
    expect(naming.children[1]).toBe(body);
    const actionRow = naming.lastElementChild as HTMLElement;
    expect(actionRow.className).toBe('row');
    expect([...actionRow.children].map((child) => child.className)).toEqual(['spacer', 'btn', 'btn primary']);
  });
});
