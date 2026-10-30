/**
 * The requirement rows of the setup check (prototype `screen-setup-check`): Claude Code, the GitHub command-line
 * tool and the GitHub account, each with its status and, when something is missing, what to do about it.
 */
import type { GitHubIdentity, IdentityResult, ToolName, ToolStatus, ToolsReport } from '../../../shared/tools';
import { badge, button, list } from '../../theme/components';
import { code, el, fragment, statusDot, type Content } from './dom';

/** What the rows show: the check under way, a check that failed, or its answer. */
export type CheckView =
  | { phase: 'checking' }
  | { phase: 'failed' }
  | { phase: 'done'; report: ToolsReport; identity: IdentityResult | null };

/** The one-time step that lets `gh` read the member's email (PRD section 4.1 item 3). */
export const EMAIL_SCOPE_COMMAND = 'gh auth refresh -h github.com -s user:email';

const ACCOUNT_NAME = 'GitHub account';

interface ToolCopy {
  name: string;
  /** Fresh nodes on every call: a DOM node placed twice would leave the first place. */
  about(): Content[];
  installSteps(): Content[][];
  signedOut(command: string): Content[];
}

const TOOL_COPY: Record<ToolName, ToolCopy> = {
  claude: {
    name: 'Claude Code',
    about: () => ['Grillo runs its agents in Claude Code, signed in with your own Claude subscription (any plan).'],
    installSteps: () => [
      ['Install Claude Code.'],
      ['Sign in once: open a terminal, run ', code('claude'), ' and follow the sign-in.'],
    ],
    signedOut: (command) => [
      'You are signed out of Claude Code. Sign in once with your own Claude subscription: open a terminal, run ',
      code(command),
      ' and follow the sign-in. Then press Check again.',
    ],
  },
  gh: {
    name: 'GitHub command-line tool (gh)',
    about: () => ["Grillo keeps every project in your company's GitHub through ", code('gh'), '.'],
    installSteps: () => [
      ['Install ', code('gh'), '.'],
      ['Sign in once: run ', code('gh auth login'), ' and follow the steps in your browser.'],
    ],
    signedOut: (command) => [
      'You are signed out of GitHub. Sign in once with your company GitHub account: open a terminal, run ',
      code(command),
      ' and follow the steps in your browser. Then press Check again.',
    ],
  },
};

const isReady = (status: ToolStatus): boolean => status.installed && status.signedIn;

/** Every row is green: both tools installed and signed in, and the GitHub identity read. */
export function isAllGreen(view: CheckView): boolean {
  return view.phase === 'done' && isReady(view.report.claude) && isReady(view.report.gh) && view.identity?.ok === true;
}

/** "Check again" is offered once a check has finished and something is left to fix, the email included. */
export function offersCheckAgain(view: CheckView): boolean {
  if (view.phase === 'checking') return false;
  if (!isAllGreen(view)) return true;
  return view.phase === 'done' && view.identity?.ok === true && view.identity.identity.email === null;
}

/** Any tool not installed: the screen opens with the prototype's "needs two tools" note. */
export function anyToolMissing(view: CheckView): boolean {
  return view.phase === 'done' && (!view.report.claude.installed || !view.report.gh.installed);
}

/** A row with only a name and one badge on the right. */
function simpleRow(name: string, tone: 'ok' | 'err' | 'neutral', label: string): DocumentFragment {
  const badgeTone = tone === 'neutral' ? undefined : tone;
  return fragment([el('span', 'row', [statusDot(tone), el('span', 'strong', [name])]), badge(label, badgeTone)]);
}

/** A row whose left side grows to hold an explanation under the name and badges. */
function detailedRow(heading: Content[], details: Content[], action?: HTMLElement): DocumentFragment {
  const left = el('div', 'grow', [el('div', 'row', heading), ...details]);
  return fragment(action ? [left, action] : [left]);
}

function toolRow(tool: ToolName, status: ToolStatus): DocumentFragment {
  const copy = TOOL_COPY[tool];
  const name = el('span', 'strong', [copy.name]);
  const { guidance } = status;
  if (guidance?.action === 'install') {
    const steps = el(
      'ol',
      'steps small',
      copy.installSteps().map((step) => el('li', '', step)),
    );
    const openGuide = button('Open install guide', { small: true, onClick: () => window.open(guidance.url) });
    return detailedRow(
      [statusDot('err'), name, badge('Not found', 'err')],
      [el('p', 'small muted', copy.about()), steps],
      openGuide,
    );
  }
  if (guidance?.action === 'sign-in') {
    return detailedRow(
      [statusDot('err'), name, badge('Installed', 'ok'), badge('Signed out', 'err')],
      [el('p', 'small muted', copy.signedOut(guidance.command))],
    );
  }
  return fragment([
    el('span', 'row', [statusDot('ok'), name]),
    el('span', 'row', [badge('Installed', 'ok'), badge('Signed in', 'ok')]),
  ]);
}

function identityTable(identity: GitHubIdentity): HTMLTableElement {
  const missing = (text: string) => el('span', 'muted', [text]);
  const rows: Array<[string, Content]> = [
    ['Login', identity.login],
    ['Name', identity.name ?? missing('Not set on GitHub')],
    ['Email', identity.email ?? missing('Not shared yet')],
  ];
  return el(
    'table',
    'small',
    rows.map(([label, value]) => el('tr', '', [el('th', '', [label]), el('td', '', [value])])),
  );
}

function signedInAccountRow(identity: GitHubIdentity): DocumentFragment {
  const details: Content[] = [identityTable(identity)];
  if (identity.email === null) {
    details.push(
      el('p', 'small muted', [
        'GitHub shares your email with Grillo only once gh may read it. Run ',
        code(EMAIL_SCOPE_COMMAND),
        ' once in a terminal and approve it in your browser, then press Check again.',
      ]),
    );
  }
  return detailedRow(
    [statusDot('ok'), el('span', 'strong', [ACCOUNT_NAME]), badge('Signed in', 'ok')],
    details,
  );
}

function accountRow(gh: ToolStatus, identity: IdentityResult | null): DocumentFragment {
  if (!gh.installed || (identity?.ok === false && identity.reason === 'not-installed')) {
    return simpleRow(ACCOUNT_NAME, 'neutral', 'Waits for gh');
  }
  if (!gh.signedIn || (identity?.ok === false && identity.reason === 'signed-out')) {
    return simpleRow(ACCOUNT_NAME, 'err', 'Not signed in');
  }
  if (identity?.ok) return signedInAccountRow(identity.identity);
  return detailedRow(
    [statusDot('err'), el('span', 'strong', [ACCOUNT_NAME]), badge('Could not read', 'err')],
    [el('p', 'small muted', ['Grillo could not read your GitHub account. Press Check again.'])],
  );
}

function placeholderRows(label: string): DocumentFragment[] {
  return [TOOL_COPY.claude.name, TOOL_COPY.gh.name, ACCOUNT_NAME].map((name) => simpleRow(name, 'neutral', label));
}

/** The list of the three requirement rows for one view. */
export function renderRequirements(view: CheckView): HTMLUListElement {
  let items: DocumentFragment[];
  if (view.phase === 'checking') items = placeholderRows('Checking…');
  else if (view.phase === 'failed') items = placeholderRows('Not checked');
  else {
    const { report, identity } = view;
    items = [toolRow('claude', report.claude), toolRow('gh', report.gh), accountRow(report.gh, identity)];
  }
  const rows = list(items);
  rows.classList.add('card', 'requirements');
  return rows;
}
