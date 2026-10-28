import { button } from '../../theme/components';

export interface TypeBox {
  el: HTMLElement;
  /** Replaces the text in the box, as the session feature does with the live transcript. */
  setValue(text: string): void;
}

/**
 * The prototype's type box under the terminal: a one-line field and Send. Enter or Send hands the text over and
 * empties the field.
 */
export function createTypeBox(onSend: (text: string) => void): TypeBox {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type to the agent…';
  input.setAttribute('aria-label', 'Type to the agent');

  function send(): void {
    const text = input.value;
    input.value = '';
    onSend(text);
  }

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    send();
  });

  const el = document.createElement('div');
  el.className = 'typebox';
  el.append(input, button('Send', { onClick: send }));

  return {
    el,
    setValue(text) {
      input.value = text;
    },
  };
}
