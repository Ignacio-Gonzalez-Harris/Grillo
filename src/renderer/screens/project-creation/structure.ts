/**
 * The PRD structure editor's operations (PRD section 4.2 item 2): add, remove, rename and reorder sections. Each one
 * returns a new structure and never changes the one it is given, so the screen can redraw from the result.
 */
import type { PrdSection, PrdStructure } from '../../../main/store/types';
import { StoreError } from '../../../shared/store';

function withSections(sections: PrdSection[]): PrdStructure {
  return { sections };
}

function copy(structure: PrdStructure): PrdSection[] {
  return structure.sections.map((section) => ({ ...section }));
}

/** Moves a section one place up (`-1`) or down (`1`); the first cannot go up nor the last down. */
export function moveSection(structure: PrdStructure, index: number, step: -1 | 1): PrdStructure {
  const sections = copy(structure);
  const target = index + step;
  if (target < 0 || target >= sections.length) return withSections(sections);
  [sections[index], sections[target]] = [sections[target], sections[index]];
  return withSections(sections);
}

/** A new section with no name or note yet, at the end. */
export function addSection(structure: PrdStructure): PrdStructure {
  return withSections([...copy(structure), { name: '', note: '' }]);
}

export function removeSection(structure: PrdStructure, index: number): PrdStructure {
  return withSections(copy(structure).filter((_section, at) => at !== index));
}

export function renameSection(structure: PrdStructure, index: number, name: string): PrdStructure {
  return withSections(copy(structure).map((section, at) => (at === index ? { ...section, name } : section)));
}

export function setSectionNote(structure: PrdStructure, index: number, note: string): PrdStructure {
  return withSections(copy(structure).map((section, at) => (at === index ? { ...section, note } : section)));
}

/** What the store would refuse in this structure, said for the member; null when it can be saved. */
export function structureProblem(structure: PrdStructure): string | null {
  const names = structure.sections.map((section) => section.name.trim());
  if (names.length === 0) return 'The PRD structure needs at least one section.';
  if (names.some((name) => name === '')) return 'Every section needs a name.';
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice !== undefined) return `Two sections are both called "${twice}": give each section its own name.`;
  return null;
}

/** The row `structureProblem` speaks of; null when nothing is wrong or no one row is to blame (there is no section). */
export function structureProblemRow(structure: PrdStructure): number | null {
  const names = structure.sections.map((section) => section.name.trim());
  const blank = names.indexOf('');
  if (blank !== -1) return blank;
  const twice = names.findIndex((name, index) => names.indexOf(name) !== index);
  return twice === -1 ? null : twice;
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** A structure as the store sent it, checked before it is drawn; anything else is one `backend` StoreError. */
export function checkedStructure(value: unknown, what: string): PrdStructure {
  const sections = (value as { sections?: unknown } | null)?.sections;
  const readable =
    Array.isArray(sections) &&
    sections.every((section: unknown) => {
      const candidate = section as Partial<Record<keyof PrdSection, unknown>> | null;
      return isText(candidate?.name) && isText(candidate.note);
    });
  if (!readable) throw new StoreError('backend', `Grillo could not read ${what} from the store.`);
  return withSections((sections as PrdSection[]).map(({ name, note }) => ({ name, note })));
}
