import { describe, expect, it, vi } from 'vitest';
import { callAudioSupport, installCallAudioHandler, type DisplayMediaHost, type LoopbackStreams } from './loopback';

type Handler = Parameters<DisplayMediaHost<string>['setDisplayMediaRequestHandler']>[0];

function host(screens: () => Promise<string[]>) {
  let installed: Handler | undefined;
  const fake: DisplayMediaHost<string> = {
    setDisplayMediaRequestHandler: vi.fn((handler: Handler) => {
      installed = handler;
    }),
    getScreenSources: screens,
  };
  const request = () =>
    new Promise<LoopbackStreams<string> | null>((resolve) => {
      if (!installed) throw new Error('no handler installed');
      installed({}, resolve);
    });
  return { fake, request };
}

describe('call audio', () => {
  it('is supported on Windows and on macOS 14.2+; an older Mac gets a typed unsupported answer', () => {
    expect(callAudioSupport('win32')).toEqual({ supported: true });
    expect(callAudioSupport('darwin', '14.2')).toMatchObject({ supported: true });
    expect(callAudioSupport('darwin', '14.1')).toEqual({ supported: false, reason: expect.stringContaining('Mac') });
  });

  it('on Windows answers display-media requests with loopback audio and the first screen', async () => {
    const { fake, request } = host(async () => ['screen:1', 'screen:2']);
    installCallAudioHandler('win32', fake);

    await expect(request()).resolves.toEqual({ video: 'screen:1', audio: 'loopback' });
  });

  it('refuses the request when there is no screen to pair with, or listing screens fails', async () => {
    const none = host(async () => []);
    const failing = host(async () => {
      throw new Error('desktop capturer unavailable');
    });
    installCallAudioHandler('win32', none.fake);
    installCallAudioHandler('win32', failing.fake);

    await expect(none.request()).resolves.toBeNull();
    await expect(failing.request()).resolves.toBeNull();
  });

  it('installs nothing on a Mac older than macOS 14.2', () => {
    const { fake } = host(async () => ['screen:1']);
    installCallAudioHandler('darwin', fake, '14.1');

    expect(fake.setDisplayMediaRequestHandler).not.toHaveBeenCalled();
  });
});
