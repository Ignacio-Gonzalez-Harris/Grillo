// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { badge, button, dialog, glassPanel, list, toggle } from './components';

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
