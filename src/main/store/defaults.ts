import type { PrdStructure } from './types';

/** The PRD structure Grillo ships (PRD section 4.2 item 2): used when a new project picks none. */
export const DEFAULT_PRD_STRUCTURE: PrdStructure = {
  sections: [
    { name: 'Problem', note: 'What goes wrong today, and the outcomes wanted' },
    { name: 'Users and roles', note: 'Who uses the product, and what each person may do' },
    { name: 'Vocabulary', note: 'One name per thing, used in every screen and document' },
    { name: 'Flows', note: 'What people do, step by step' },
    { name: 'Screens', note: 'Every screen, and what it holds' },
    { name: 'Data model', note: 'The records kept, and where each one lives' },
    { name: 'Permissions', note: 'Who may see and change what' },
    { name: 'Build decisions', note: 'The technical choices, and why' },
    { name: 'Design system', note: 'The look every screen follows' },
    { name: 'Do-not-build list', note: 'What must never be built' },
    { name: 'Acceptance demo', note: 'The walkthrough that proves the release works' },
    { name: 'Release order', note: 'What ships in which release' },
    { name: 'Assumptions', note: 'What is still unverified' },
  ],
};
