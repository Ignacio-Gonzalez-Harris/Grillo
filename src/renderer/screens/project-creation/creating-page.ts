/**
 * The creating progress (prototype states `creating*` and `agent-refused`): each step as it runs, what stopped it, and
 * the ways on from there.
 */
import type { ProjectId } from '../../../main/store/types';
import type { AgentId } from '../../../shared/agents';
import { badge, button } from '../../theme/components';
import type { Creation } from './create';
import { el, note, pageActions, pageHead } from './view';

export interface CreatingActions {
  busy: boolean;
  /** Back to the Where step; offered only while nothing has been created, so the answers can still change. */
  backToWhere(): void;
  openMap(project: ProjectId): void;
  openAgent(agentId: AgentId): void;
  tryAgain(): void;
}

function headOf(creation: Creation): HTMLElement {
  if (creation.steps.some((step) => step.state === 'failed')) {
    return pageHead('Something stopped the set-up', 'The steps marked Done are safe and will not run twice. The reason is below.');
  }
  if (creation.project() !== null && creation.agent() !== null) {
    return pageHead('Your project is on its way', 'Grillo has done its part. The grilling agent is building the map and the tickets now.');
  }
  return pageHead('Setting up your project', 'Grillo is working through these steps, one at a time.');
}

export function creatingPage(creation: Creation, actions: CreatingActions): HTMLElement[] {
  const { busy } = actions;
  const lastIndex = creation.steps.length - 1;
  const rows = creation.steps.map((step, index) => {
    const working = step.state === 'running' || (step.state === 'done' && index === lastIndex);
    const partly = step.state === 'done' && step.warning !== null;
    const dot = { waiting: '', running: 'warn', done: working || partly ? 'warn' : 'ok', failed: 'err' }[step.state];
    const status = working
      ? badge('Working…', 'warn')
      : partly
        ? badge('Partly done', 'warn')
        : step.state === 'done'
          ? badge('Done', 'ok')
          : step.state === 'failed'
            ? badge('Failed', 'err')
            : badge('Waiting');
    const row = el('li', '', [el('span', 'row', [el('span', `sdot ${dot}`.trim()), step.label]), status]);
    if (partly && step.warning !== null) row.append(el('p', 'small muted m0 full', [step.warning]));
    return row;
  });
  const failed = creation.steps.find((step) => step.state === 'failed');
  const parts: HTMLElement[] = [headOf(creation), el('ul', 'rows card', rows)];
  if (failed) {
    parts.push(note(failed.error ?? 'This step failed.', 'err'));
    const created = creation.project();
    parts.push(
      pageActions([
        created === null
          ? button('Back to Where', { disabled: busy, onClick: actions.backToWhere })
          : button('Open the map', { disabled: busy, onClick: () => actions.openMap(created) }),
        button('Try again', { variant: 'primary', disabled: busy, onClick: actions.tryAgain }),
      ]),
    );
  }
  const project = creation.project();
  const agentId = creation.agent();
  if (project !== null && agentId !== null) {
    parts.push(
      el('p', 'note small', ['Tickets appear on the map as the engine creates them, and you can edit them at once.']),
      pageActions([
        button('Open the map', { onClick: () => actions.openMap(project) }),
        button('Open the grilling agent', { variant: 'primary', onClick: () => actions.openAgent(agentId) }),
      ]),
    );
  }
  return parts;
}
