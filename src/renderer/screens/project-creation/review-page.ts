/**
 * The review page (prototype states `review*`): each step's answers with a way back to change them. It reads the same
 * facts the draft is made from, so what it lists is what gets created.
 */
import { button } from '../../theme/components';
import { canInvite, ideaOf, ownedByMember, repositoryToConnect, STEP_NAMES, type FormStep } from './form';
import { structureSummary } from './step-structure';
import { ACCESS_BADGES, PUBLIC_WARNING, READ_ACCESS_HINT } from './step-where';
import type { WizardContext } from './wizard';
import { el, note, pageHead, type Content } from './view';

type Answer = [question: string, answer: Content];

interface StepAnswers {
  rows: Answer[];
  /** A warning or a reminder under the answers. */
  extra: HTMLElement[];
}

function answerList(rows: Answer[]): HTMLElement {
  return el(
    'dl',
    'answers',
    rows.flatMap(([question, answer]) => [el('dt', '', [question]), el('dd', '', [answer])]),
  );
}

function accessAnswer(ctx: WizardContext): Content {
  const { access } = ctx.form;
  switch (access.state) {
    case 'known':
      return ACCESS_BADGES[access.permission]();
    case 'unknown':
      return 'Not known';
    default:
      return 'Not checked yet';
  }
}

function whereAnswers(ctx: WizardContext): StepAnswers {
  const { form } = ctx;
  if (form.mode === 'connect') {
    const repository = repositoryToConnect(form.connectTo);
    return {
      rows: [
        ['Repository', repository ? `${repository.owner}/${repository.name}` : ''],
        ['Your access', accessAnswer(ctx)],
      ],
      extra: form.access.state === 'known' && form.access.permission === 'read' ? [el('p', 'reason m0', [READ_ACCESS_HINT])] : [],
    };
  }
  const own = ownedByMember(form);
  const open = own && form.visibility === 'public';
  return {
    rows: [
      ['Project name', form.projectName.trim() || 'Not given'],
      ['Owner', own ? `${form.organisation} (your account)` : form.organisation],
      ['Repository', `${form.organisation}/${form.repositoryName.trim()}`],
      ['Visibility', open ? 'Public' : 'Private'],
    ],
    extra: open ? [note(PUBLIC_WARNING, 'warn')] : [],
  };
}

function structureAnswers(ctx: WizardContext): StepAnswers {
  return {
    rows: [
      ['Starts from', structureSummary(ctx)],
      ['Sections', ctx.form.structure.sections.map(({ name }) => name.trim()).join(', ')],
    ],
    extra: [],
  };
}

function peopleAnswers(ctx: WizardContext): StepAnswers {
  const { form, myLogin, drafts } = ctx;
  const allowed = canInvite(form);
  const extra: HTMLElement[] = [];
  const login = drafts.invite.trim();
  if (allowed && login !== '') extra.push(el('p', 'reason m0', [`You typed ${login} but did not press Invite, so ${login} will not be invited.`]));
  const domain = drafts.domain.trim();
  if (domain !== '') extra.push(el('p', 'reason m0', [`You typed ${domain} but did not press Add domain, so it will not be saved.`]));
  return {
    rows: [
      ['You', myLogin ?? 'You'],
      ['Your role', form.role.trim() || 'Not set yet'],
      ['Your domains', form.domains.join(', ') || 'None yet'],
      ['Invited', allowed ? form.invites.join(', ') || 'Nobody yet' : 'Nobody: inviting needs admin rights'],
    ],
    extra,
  };
}

function ideaAnswers(ctx: WizardContext): StepAnswers {
  const { form } = ctx;
  const written = form.ideaFormat === 'text';
  const documents = written ? form.attachments.map(({ name }) => name) : [];
  const rows: Answer[] = [[written ? 'Written text' : 'Transcript', el('span', 'clamped', [ideaOf(form)])]];
  if (documents.length > 0) rows.push(['Documents', documents.join(', ')]);
  return { rows, extra: [] };
}

export function reviewHead(actionLabel: string): HTMLElement {
  return pageHead('Does this look right?', `Nothing has been created yet. Check your answers, then press ${actionLabel}.`);
}

export function reviewList(ctx: WizardContext, change: (step: FormStep) => void): HTMLElement {
  const row = (step: FormStep, { rows, extra }: StepAnswers): HTMLElement => {
    const changeIt = button('Change', { small: true, disabled: ctx.busy, onClick: () => change(step) });
    changeIt.setAttribute('aria-label', `Change ${STEP_NAMES[step]}`);
    return el('li', '', [el('div', 'grow stack', [el('span', 'strong', [STEP_NAMES[step]]), answerList(rows), ...extra]), changeIt]);
  };
  return el('ul', 'rows card review', [
    row('where', whereAnswers(ctx)),
    row('structure', structureAnswers(ctx)),
    row('people', peopleAnswers(ctx)),
    row('idea', ideaAnswers(ctx)),
  ]);
}
