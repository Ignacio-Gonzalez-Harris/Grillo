# ADR: Mac call-audio capture

- **Status:** Proposed (approving this pull request accepts it)
- **Date:** 2026-10-22
- **Issue:** issue #62 (ADR: Mac call-audio capture), under epic issue #54 (Live meeting)
- **Evidence base:** desk research only. This ADR was written on a Windows machine; nothing in it was run on a Mac.
  Every statement below is either backed by a cited source or labelled **Assumption**.

## Context

PRD section 4.5 item 4 says Grillo captures the room microphone *or the call audio* on the host's laptop and
transcribes it locally. PRD section 8 (Toolkit) records that system-audio capture is documented on macOS 14.2+
through the CoreAudio tap, and that a missing permission fails silently, so Grillo must check it itself. PRD section 13
lists Mac transcription and call-audio accuracy as unverified. The interview on issue #62 settled that release 1 ships
the microphone on both systems and call audio on Windows; Mac call audio follows as its own story once this ADR is
approved.

The decision is hard to reverse because the obvious answer is "add a native module", which brings a build toolchain,
a per-architecture binary, signing and notarisation work, and a dependency to maintain.

What the research found:

1. **Electron already captures Mac system audio through the CoreAudio tap.** Electron's `desktopCapturer` docs state:
   "Since Electron 39, Chromium uses the CoreAudio Tap API by default for system audio capture on macOS 14.2 and
   later." The app grants it in `session.setDisplayMediaRequestHandler` with `audio: 'loopback'` and the renderer
   calls `getDisplayMedia({ audio: true, video: ... })`, the same shape Grillo uses for Windows loopback. [1]
2. **The older ScreenCaptureKit audio path is gone.** There is no automatic fallback if tap creation fails, and as of
   Electron 45 the `MacCatapLoopbackAudioForScreenShare` flag that opted back into ScreenCaptureKit "has been removed
   upstream and no longer has any effect". [1] The current Electron release is v45.0.0. [8]
3. **The permission and its silent failure.** Apple's process tap API was introduced in macOS 14.2 [2]. The app needs
   the `NSAudioCaptureUsageDescription` key in `Info.plist`; the system shows the "System Audio Recording" prompt the
   first time a tap starts recording [1][3]. Electron warns: "If the permission is missing or has been denied,
   `desktopCapturer` still produces an audio track, but it is created in the `ended` state and never delivers
   samples. No warning or error is surfaced to JavaScript." [1] macOS attributes the permission to the responsible
   process, so when Grillo runs unpackaged from a terminal (`npm run dev`), the terminal needs the key and the grant. [1]
4. **There is no public API to check or request this permission ahead of time.** AudioCap, Apple-API sample code by
   a well-known macOS developer (BSD-2-Clause), says so and checks it through the private TCC service
   `kTCCServiceAudioCapture` behind a build flag. [4] Electron's `systemPreferences.getMediaAccessStatus` covers only
   `microphone`, `camera` and `screen`. [5]
5. **Native options exist but carry costs.** AudioTee is a small Swift command-line helper that streams tap PCM to
   stdout on macOS 14.2+ [6]; its Node wrapper `audiotee` on npm declares MIT, but neither GitHub repository carries a
   licence file (GitHub reports none), and its README warns the API is unstable [6][7]. `native-audio-node` on npm
   (MIT, system audio and microphone on macOS and Windows) lists no source repository [7]. A Node add-on must be
   rebuilt against Electron's ABI with `@electron/rebuild` [9]; a separate helper process does not touch the ABI.
6. **Signing.** Hardened Runtime is a prerequisite for notarisation; electron-builder enables it by default for
   `darwin` builds and adds `Info.plist` keys through `mac.extendInfo`. [10] PRD section 8 already notes that an
   unsigned Mac update may need "Open Anyway" and the audio permission again.

## Decision

**Capture Mac call audio with Electron's built-in loopback, not a native module.**

1. Grillo pins **Electron 39 or later** (the scaffold story picks the exact version; v45 is current [8]) and supports
   Mac call audio on **macOS 14.2 and later**. On older macOS the call-audio option is hidden and the microphone
   path (the audio capture story) is used.
2. The main process grants `audio: 'loopback'` in `setDisplayMediaRequestHandler`, sharing one code path with Windows;
   the renderer calls `getDisplayMedia` and stops the video track at once, keeping only the audio track.
3. The packaged app sets `NSAudioCaptureUsageDescription` through electron-builder's `mac.extendInfo`, with a one-line
   reason such as "Grillo transcribes the call on this laptop."
4. **The permission check:** right after `getDisplayMedia` resolves, Grillo reads the audio track's `readyState`.
   `ended` means the System Audio Recording permission is missing or denied: Grillo stops, says so in one line, and
   offers to open System Settings at Privacy & Security. A track that is `live` but delivers no audio frames within a
   few seconds is reported the same way. Silence inside the frames is not an error (nobody may be talking).
5. The capture sits behind the same swappable audio-source interface as the Windows and microphone sources, so the
   fallback below can replace it without touching transcription.

**Fallback, only if the story's Mac test shows the built-in route failing:** bundle a small in-house Swift helper
that creates the tap and writes PCM to stdout, spawned from the main process. It is written from Apple's sample and
the AudioCap description [3][4], not copied from AudioTee, because AudioTee's repositories carry no licence file.
A separate process needs no `@electron/rebuild` and does not change with Electron's ABI; it is built on the Mac CI
runner with `swift build` for both architectures, ships inside the app bundle and is signed with it. The same
`ended`-or-no-frames check applies to its output.

## Consequences

**Good**

- No native dependency in release 1's Mac call-audio path: no node-gyp, no Swift toolchain, nothing to rebuild when
  Electron is upgraded.
- One capture code path for Windows and Mac; the difference is one `Info.plist` key and a version check.
- The silent failure is turned into a visible message, as PRD section 8 requires.

**Bad, and risks to verify in the Mac story (none could be tested here)**

- **Assumption: Screen Recording permission may also be needed.** `getDisplayMedia` asks for a video source, and
  Electron's docs say capturing screen contents needs user consent on macOS 10.15+ [1]. If so, the host grants two
  permissions, and on macOS 15 press reports describe a monthly Screen Recording re-prompt [11] (2024 beta coverage,
  not Apple documentation). The story must confirm on a real Mac whether stopping the video track avoids this. If it
  does not and the prompts are unacceptable, that alone triggers the fallback, which needs only the audio permission.
- **Electron's docs disagree with each other.** The `session` page still says loopback "is currently only supported
  on Windows" [12], while the `desktopCapturer` page documents the macOS 14.2+ tap path [1]. This ADR follows the more
  specific, newer `desktopCapturer` text; the Mac test settles it.
- **Assumption:** an `ended` track on start is the only signal of a denied permission. The permission cannot be
  checked before the first recording without private API, so the first-ever session on a laptop shows the macOS
  prompt mid-start.
- **Assumption:** the tap mixes all system output, so Grillo's own sounds (if any) and other apps' audio are captured
  too. Acceptable for release 1; a per-process tap would need the native fallback.
- **Assumption:** with the unsigned pilot build, each update may reset the System Audio Recording grant, as PRD
  section 8 already warns for the audio permission. Signing (owner still to be named) fixes this.
- During development the terminal running `npm run dev` holds the permission, not Grillo. [1]

## Alternatives considered

| Option | Why not chosen |
|---|---|
| Native Node add-on over the tap (`native-audio-node`, MIT) [7] | Compiled per architecture, rebuilt for every Electron ABI change [9], no listed source repository to audit; adds the node-pty-style build risk PRD section 8 already carries, for no gain over the built-in route. |
| AudioTee helper or `audiotee` npm wrapper [6][7] | Right shape (separate process, no ABI tie) but no licence file in either repository and an "unstable API" warning. Its design informs the in-house fallback instead. |
| Private TCC check (`kTCCServiceAudioCapture`) to pre-check the permission [4] | Private Apple API: undocumented, can break in any macOS update. The `ended`-track check needs no private API. |
| Virtual audio driver (BlackHole, Soundflower) [1] | Each host must install a system audio driver and reroute output; Electron lists it only for macOS 12 and older. |
| ScreenCaptureKit audio via the Chromium flag [1] | The flag is removed as of Electron 45. |
| No Mac call audio | Hosts on a Mac call could only use the room microphone; PRD section 4.5 item 4 asks for call audio. |

## Sources

1. Electron, `desktopCapturer` API docs (macOS 14.2+ and 12.7.6 sections, notes on `getSources`):
   https://www.electronjs.org/docs/latest/api/desktop-capturer
2. Apple, `AudioHardwareCreateProcessTap` (introduced in macOS 14.2):
   https://developer.apple.com/documentation/coreaudio/audiohardwarecreateprocesstap(_:_:)
3. Apple, Capturing system audio with Core Audio taps:
   https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps
4. insidegui/AudioCap, README and `AudioRecordingPermission.swift` (BSD-2-Clause):
   https://github.com/insidegui/AudioCap
5. Electron, `systemPreferences.getMediaAccessStatus`:
   https://www.electronjs.org/docs/latest/api/system-preferences
6. makeusabrew/audiotee (no licence file): https://github.com/makeusabrew/audiotee
7. npm registry: `audiotee` 0.0.7 (MIT, https://www.npmjs.com/package/audiotee) and `native-audio-node` 0.3.5 (MIT,
   https://www.npmjs.com/package/native-audio-node)
8. Electron releases (latest v45.0.0): https://github.com/electron/electron/releases
9. Electron, Using native Node modules: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
10. electron-builder, macOS options (`hardenedRuntime`, `extendInfo`, `notarize`): https://www.electron.build/mac.html
11. 9to5Mac, macOS Sequoia screen recording prompt monthly (2024):
    https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/
12. Electron, `session.setDisplayMediaRequestHandler`: https://www.electronjs.org/docs/latest/api/session
