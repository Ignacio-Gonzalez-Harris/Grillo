/**
 * Step 2, Structure, and the section rows the editor of an existing project shares with it (prototype states
 * `structure-step` and `structure`).
 */
import { DEFAULT_PRD_STRUCTURE } from '../../../main/store/defaults';
import type { PrdStructure } from '../../../main/store/types';
import { button } from '../../theme/components';
import { DEFAULT_STRUCTURE_CHOICE } from './form';
import { addSection, moveSection, removeSection, renameSection, setSectionNote, structureProblemRow } from './structure';
import type { WizardContext } from './wizard';
import { el, field, pageHead, reasonNote, textInput } from './view';

function moveButton(arrow: string, label: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const move = button(arrow, { small: true, disabled, onClick });
  move.setAttribute('aria-label', label);
  return move;
}

export interface StructureRowsOptions {
  busy: boolean;
  /** Why the structure stopped the member; it shows on the row to blame, or under the list when none is. */
  reason: string | null;
  update(next: PrdStructure, redraw: boolean): void;
}

function rowReason(reason: string): HTMLElement {
  const element = reasonNote(reason);
  element.classList.add('full');
  return element;
}

export function structureRows(structure: PrdStructure, { busy, reason, update }: StructureRowsOptions): HTMLElement[] {
  const last = structure.sections.length - 1;
  const blamed = reason === null ? null : structureProblemRow(structure);
  const list = el(
    'ul',
    'rows structure',
    structure.sections.map((section, index) =>
      el('li', '', [
        el('span', 'row', [
          moveButton('↑', 'Move up', busy || index === 0, () => update(moveSection(structure, index, -1), true)),
          moveButton('↓', 'Move down', busy || index === last, () => update(moveSection(structure, index, 1), true)),
        ]),
        el('div', 'grow grid-2', [
          textInput({
            value: section.name,
            label: 'Section name',
            disabled: busy,
            onInput: (value) => {
              structure = renameSection(structure, index, value);
              update(structure, false);
            },
          }),
          textInput({
            value: section.note,
            label: 'Section note',
            disabled: busy,
            onInput: (value) => {
              structure = setSectionNote(structure, index, value);
              update(structure, false);
            },
          }),
        ]),
        button('Remove', { small: true, disabled: busy, onClick: () => update(removeSection(structure, index), true) }),
        ...(reason !== null && blamed === index ? [rowReason(reason)] : []),
      ]),
    ),
  );
  return [list, ...(reason !== null && blamed === null ? [reasonNote(reason)] : [])];
}

/** Where the section list starts from, for the folded line and the review page. */
export function structureSummary(ctx: WizardContext): string {
  const { form, earlierProjects } = ctx;
  const earlier = earlierProjects.find((project) => project.id === form.structureFrom);
  const count = form.structure.sections.length;
  return `${earlier ? earlier.name : 'Grillo default'} · ${count} ${count === 1 ? 'section' : 'sections'}`;
}

export function structureHead(): HTMLElement {
  return pageHead(
    'How should the PRD be organised?',
    'The PRD (product requirements document) is the document Grillo writes for this project. These are its sections. The default suits most projects, so you can press Next and change it later.',
  );
}

export function structureCard(ctx: WizardContext): HTMLElement {
  const { form, earlierProjects, busy, reason } = ctx;
  if (!form.structureOpen) {
    return el('div', 'card stack', [
      el('div', 'row', [
        el('span', '', [structureSummary(ctx)]),
        el('span', 'spacer'),
        button('Edit', {
          small: true,
          disabled: busy,
          onClick: () => {
            form.structureOpen = true;
            ctx.redraw();
          },
        }),
      ]),
    ]);
  }
  const from = el('select', '', [
    Object.assign(el('option', '', ['Grillo default']), { value: DEFAULT_STRUCTURE_CHOICE }),
    ...earlierProjects.map((project) =>
      Object.assign(el('option', '', [`${project.name} (an earlier project of yours)`]), { value: project.id }),
    ),
  ]);
  from.value = form.structureFrom;
  from.disabled = busy;
  from.addEventListener('change', () => {
    form.structureFrom = from.value;
    const earlier = earlierProjects.find((project) => project.id === from.value);
    form.structure = structuredClone(earlier ? earlier.structure : DEFAULT_PRD_STRUCTURE);
    ctx.clearReason();
    ctx.redraw();
  });
  return el('div', 'card stack', [
    field('Start from', from),
    el('p', 'small muted m0', ['With no choice made, the default applies. Edit it now or at any time later.']),
    ...structureRows(form.structure, {
      busy,
      reason,
      update: (next, redraw) => {
        form.structure = next;
        ctx.clearReason();
        if (redraw) ctx.redraw();
      },
    }),
    el('div', 'row', [
      button('Add section', {
        small: true,
        disabled: busy,
        onClick: () => {
          form.structure = addSection(form.structure);
          ctx.clearReason();
          ctx.redraw();
        },
      }),
    ]),
  ]);
}
