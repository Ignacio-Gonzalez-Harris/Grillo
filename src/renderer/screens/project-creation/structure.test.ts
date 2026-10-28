import { describe, expect, it } from 'vitest';
import { DEFAULT_PRD_STRUCTURE } from '../../../main/store/defaults';
import type { PrdStructure } from '../../../main/store/types';
import { StoreError } from '../../../shared/store';
import {
  addSection,
  checkedStructure,
  moveSection,
  removeSection,
  renameSection,
  setSectionNote,
  structureProblem,
} from './structure';

// Made-up section names only.
const THREE: PrdStructure = {
  sections: [
    { name: 'Sample section 1', note: 'Note 1' },
    { name: 'Sample section 2', note: 'Note 2' },
    { name: 'Sample section 3', note: 'Note 3' },
  ],
};

const names = (structure: PrdStructure) => structure.sections.map((section) => section.name);

describe('the PRD structure editor', () => {
  it('moves a section up or down, and leaves the first and last in place at the ends', () => {
    expect(names(moveSection(THREE, 1, -1))).toEqual(['Sample section 2', 'Sample section 1', 'Sample section 3']);
    expect(names(moveSection(THREE, 1, 1))).toEqual(['Sample section 1', 'Sample section 3', 'Sample section 2']);
    expect(moveSection(THREE, 0, -1)).toEqual(THREE);
    expect(moveSection(THREE, 2, 1)).toEqual(THREE);
  });

  it('adds an empty section at the end, removes one, renames one and changes its note, never changing the original', () => {
    const before = structuredClone(THREE);

    expect(addSection(THREE).sections.at(-1)).toEqual({ name: '', note: '' });
    expect(names(removeSection(THREE, 0))).toEqual(['Sample section 2', 'Sample section 3']);
    expect(renameSection(THREE, 2, 'Sample added section').sections[2]).toEqual({ name: 'Sample added section', note: 'Note 3' });
    expect(setSectionNote(THREE, 0, 'A new note').sections[0]).toEqual({ name: 'Sample section 1', note: 'A new note' });
    expect(THREE).toEqual(before);
  });

  it('accepts the shipped default of 13 sections', () => {
    expect(DEFAULT_PRD_STRUCTURE.sections).toHaveLength(13);
    expect(structureProblem(DEFAULT_PRD_STRUCTURE)).toBeNull();
  });

  it.each([
    ['no section', { sections: [] }, 'at least one section'],
    ['a section with a blank name', { sections: [{ name: '  ', note: 'Note' }] }, 'Every section needs a name'],
    [
      'two sections with the same name once trimmed',
      { sections: [{ name: 'Problem', note: '' }, { name: ' Problem ', note: '' }] },
      'Two sections are both called "Problem"',
    ],
  ])('refuses %s, as the store would', (_case, structure, message) => {
    expect(structureProblem(structure)).toContain(message);
  });
});

describe('a structure read from the store', () => {
  it('passes a well-formed structure through', () => {
    expect(checkedStructure(THREE, 'the structure')).toEqual(THREE);
  });

  it.each([
    ['null', null],
    ['no sections list', {}],
    ['a null section', { sections: [null] }],
    ['a section with no name', { sections: [{ note: 'Note' }] }],
    ['a section whose note is not text', { sections: [{ name: 'Problem', note: 3 }] }],
  ])('refuses %s with one backend StoreError', (_case, value) => {
    const read = () => checkedStructure(value, 'the structure of example-org/sample-project-1');

    expect(read).toThrow(StoreError);
    expect(read).toThrow('Grillo could not read the structure of example-org/sample-project-1');
  });
});
