/**
 * The setup check screen (PRD section 4.1 and section 5 screen 1; prototype `screen-setup-check`): are Claude Code and
 * `gh` installed and signed in, who the member is on GitHub, what to do about anything missing, and the update card.
 */
import './setup-check.css';
import { button } from '../../theme/components';
import { PROJECT_SCREEN } from '../../app/navigation';
import type { ShellContext } from '../../app/screens';
import { el } from './dom';
import { anyToolMissing, isAllGreen, offersCheckAgain, renderRequirements, type CheckView } from './requirements';
import { runSetupCheck } from './run-check';
import { storeSetupFinished } from './setup-finished';
import { createUpdateCard, type UpdateCard } from './update-card';

/** Where Continue goes once every row is green. */
export const NEXT_SCREEN = PROJECT_SCREEN;

const TOOLS_MISSING_NOTE =
  'Grillo needs two tools on this laptop before it can start. Follow the steps below, then press Check again.';
const CHECK_FAILED_NOTE = 'Grillo could not check the tools on this laptop. Press Check again to try once more.';

export function mountSetupCheck(container: HTMLElement, shell: ShellContext): () => void {
  const { grillo } = shell;
  const root = el('div', 'setup-check');
  container.replaceChildren(root);

  let disposed = false;
  let view: CheckView = { phase: 'checking' };
  /** The update card joins the screen once the first check has finished, as in the prototype's states. */
  let cardShown = false;
  const card: UpdateCard = createUpdateCard(grillo);

  function finishSetup(): void {
    void storeSetupFinished(grillo);
    shell.navigate(NEXT_SCREEN);
  }

  function actionRow(): HTMLElement {
    const green = isAllGreen(view);
    const parts: HTMLElement[] = [];
    if (offersCheckAgain(view)) parts.push(button('Check again', { onClick: () => void check(true) }));
    parts.push(el('span', 'spacer'));
    // As in the prototype, the reason appears once there is an answer to give it.
    if (!green && view.phase !== 'checking') {
      parts.push(el('span', 'reason', ['Continue unlocks when every row is green.']));
    }
    parts.push(button('Continue', { variant: 'primary', disabled: !green, onClick: finishSetup }));
    return el('div', 'row', parts);
  }

  function render(): void {
    const note = view.phase === 'failed' ? CHECK_FAILED_NOTE : anyToolMissing(view) ? TOOLS_MISSING_NOTE : null;
    const parts: HTMLElement[] = [];
    if (note) parts.push(el('p', 'note err', [note]));
    parts.push(renderRequirements(view));
    if (cardShown) parts.push(card.root);
    parts.push(actionRow());
    root.replaceChildren(...parts);
  }

  async function check(force: boolean): Promise<void> {
    view = { phase: 'checking' };
    render();
    const next = await runSetupCheck(grillo, force);
    if (disposed) return;
    view = next;
    cardShown = true;
    render();
  }

  void check(false);

  return () => {
    disposed = true;
    card.dispose();
  };
}
