/**
 * The update card of the setup check (prototype `screen-setup-check`, state "All green, with update offer"): the offer
 * of a newer Grillo with "Download and install" and "Later", and the two update settings, app updates and speech
 * model updates. The updates and transcription features own the logic and save the settings; this card only asks.
 */
import type { GrilloApi, Unsubscribe } from '../../../shared/ipc';
import type { SpeechModelUpdates } from '../../../shared/transcription';
import { createUpdatesClient, type UpdatePhase, type UpdateState } from '../../../shared/updates';
import { badge, button, toggle } from '../../theme/components';
import { readEventVersion, readPercent, readSpeechModelUpdates, readUpdateState } from './answers';
import { el, type Content } from './dom';

/**
 * Where a member installs an update by hand (an unsigned Mac build cannot install one itself): the latest release of
 * the repository electron-builder.yml publishes to.
 */
export const RELEASE_PAGE_URL = 'https://github.com/Ignacio-Gonzalez-Harris/Grillo/releases/latest';

const SPEECH_MODE_LABELS: ReadonlyArray<[SpeechModelUpdates, string]> = [
  ['automatic', 'Automatic'],
  ['ask', 'Ask'],
  ['never', 'Never'],
];

interface Offer {
  phase: UpdatePhase;
  version: string | null;
  percent: number | null;
}

const NO_OFFER: Offer = { phase: 'none', version: null, percent: null };

export interface UpdateCard {
  root: HTMLElement;
  dispose(): void;
}

export function createUpdateCard(grillo: GrilloApi): UpdateCard {
  const updatesClient = createUpdatesClient(grillo);
  const root = el('div', 'card glass-strong stack update-card');
  let disposed = false;
  /** Null until read, and when the answer could not be used: the setting is then shown locked. */
  let updates: UpdateState | null = null;
  let speech: SpeechModelUpdates | null = null;
  let offer: Offer = NO_OFFER;

  const warn = (what: string) => (error: unknown) => console.warn(`Grillo could not ${what}.`, error);

  function setOffer(next: Offer): void {
    offer = next;
    render();
  }

  function downloadAndInstall(): void {
    if (updates?.manualInstall) {
      window.open(RELEASE_PAGE_URL);
      return;
    }
    const before = offer;
    if (offer.phase === 'available') setOffer({ ...offer, phase: 'downloading' });
    updatesClient.install().catch((error: unknown) => {
      warn('install the update')(error);
      if (!disposed) setOffer(before);
    });
  }

  function later(): void {
    setOffer(NO_OFFER);
    updatesClient.later().catch(warn('put the update off'));
  }

  async function setAutoUpdate(enabled: boolean): Promise<void> {
    try {
      // Only the switch is read from this answer: the offer follows the update events.
      updates = readUpdateState(await updatesClient.setAutoUpdate(enabled));
    } catch (error) {
      warn('save the app updates setting')(error);
    }
    if (!disposed) render();
  }

  async function setSpeechMode(mode: SpeechModelUpdates): Promise<void> {
    try {
      await grillo.invoke('transcription:set-model-updates', mode);
      speech = mode;
    } catch (error) {
      warn('save the speech model updates setting')(error);
    }
    if (!disposed) render();
  }

  function offerHeadline(version: string): Content[] {
    const yours = updates ? ` You have ${updates.currentVersion}.` : '';
    if (offer.phase === 'ready') {
      return [badge('Ready', 'ok'), el('span', 'strong', [`Grillo ${version} is downloaded. Restart Grillo to install it.`])];
    }
    if (offer.phase === 'downloading') {
      const progress = offer.percent === null ? '' : `: ${Math.round(offer.percent)}%`;
      return [badge('Update', 'warn'), el('span', 'strong', [`Downloading Grillo ${version}${progress}.`])];
    }
    return [badge('Update', 'warn'), el('span', 'strong', [`Grillo ${version} is available.${yours}`])];
  }

  function offerActions(): HTMLElement {
    const main =
      offer.phase === 'ready'
        ? button('Restart and install', { variant: 'primary', small: true, onClick: downloadAndInstall })
        : button('Download and install', {
            variant: 'primary',
            small: true,
            disabled: offer.phase === 'downloading',
            onClick: downloadAndInstall,
          });
    return el('div', 'row', [main, button('Later', { small: true, onClick: later })]);
  }

  function appUpdatesSetting(): HTMLElement {
    const autoUpdate = toggle('Install automatically on the next restart', {
      checked: updates?.autoUpdate ?? false,
      disabled: updates === null,
      onChange: (checked) => void setAutoUpdate(checked),
    });
    autoUpdate.root.classList.add('small');
    return el('div', 'stack', [
      el('span', 'small strong muted', ['App updates']),
      autoUpdate.root,
      el('p', 'small muted', ['On Mac, automatic install works only once Grillo is signed.']),
    ]);
  }

  function speechModelSetting(): HTMLElement {
    const modes = SPEECH_MODE_LABELS.map(([mode, label]) => {
      const choice = el('button', '', [label]);
      choice.type = 'button';
      choice.disabled = speech === null;
      choice.setAttribute('aria-pressed', String(mode === speech));
      choice.addEventListener('click', () => void setSpeechMode(mode));
      return choice;
    });
    const group = el('div', 'seg', modes);
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Speech model updates');
    return el('div', 'stack', [
      el('span', 'small strong muted', ['Speech model updates']),
      group,
      el('p', 'small muted', ['The local speech model that transcribes meetings on this laptop.']),
    ]);
  }

  function render(): void {
    const { version } = offer;
    const offered = offer.phase !== 'none' && version !== null;
    const parts: Content[] = [];
    if (offered) {
      parts.push(el('div', 'row', offerHeadline(version)));
      if (updates?.manualInstall) {
        parts.push(
          el('p', 'small muted', [
            'Grillo cannot install updates by itself on this Mac until it is signed. Download and install opens the ' +
              'release page: download the new version there, then drag it into Applications.',
          ]),
        );
      }
    }
    parts.push(el('div', 'grid-2', [appUpdatesSetting(), speechModelSetting()]));
    if (offered) parts.push(offerActions());
    root.setAttribute('role', offered ? 'dialog' : 'group');
    root.setAttribute('aria-label', offered ? 'Update offer' : 'Update settings');
    root.replaceChildren(...parts);
  }

  const subscriptions: Unsubscribe[] = [
    grillo.on('updates:update-available', (payload) => {
      const next = readEventVersion(payload);
      if (next) setOffer({ phase: 'available', version: next, percent: null });
    }),
    grillo.on('updates:download-progress', (payload) => {
      const next = readEventVersion(payload);
      const percent = readPercent((payload as { percent?: unknown } | null)?.percent);
      if (next && percent !== null) setOffer({ phase: 'downloading', version: next, percent });
    }),
    grillo.on('updates:ready-to-install', (payload) => {
      const next = readEventVersion(payload);
      if (next) setOffer({ phase: 'ready', version: next, percent: null });
    }),
  ];

  render();
  void Promise.allSettled([
    updatesClient.getUpdateState().then((answer) => {
      updates = readUpdateState(answer);
      offer = { phase: updates.phase, version: updates.version, percent: updates.percent };
    }),
    grillo.invoke('transcription:get-model-updates', undefined).then((answer) => {
      speech = readSpeechModelUpdates(answer);
    }),
  ]).then((results) => {
    results.forEach((result) => {
      if (result.status === 'rejected') warn('read the update settings')(result.reason);
    });
    if (!disposed) render();
  });

  return {
    root,
    dispose() {
      disposed = true;
      subscriptions.forEach((stop) => stop());
    },
  };
}

