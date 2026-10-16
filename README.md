# Fake Mic — Feed a microphone from audio files (Chrome extension)

[中文说明](README.zh-CN.md)

Testing a recording feature shouldn't require talking into a microphone over and over. This extension replaces the audio returned by `navigator.mediaDevices.getUserMedia` with an audio file you upload — so multi-round recording tests can play a different clip each round, hands-free.

- **No virtual audio device needed** — no BlackHole, no Soundflower, and no changes to the app under test.
- **The page still gets a real `MediaStream`** — `MediaRecorder`, Web Audio, `MediaStreamTrack`, and anything else that consumes microphone input works as usual.
- **Clips end in silence, not in a stopped track** — when a clip finishes, the track keeps outputting silence instead of ending. To the page this looks like a person pausing after speaking, not like the microphone was unplugged.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this project's root directory (the one containing `manifest.json`).
3. After editing the extension, hit the reload button on the extensions page, then refresh the page under test.

The extension only activates on `localhost` and `127.0.0.1` (any port, http or https) by default. To use it on another origin, add that origin to both `content_scripts` entries in `manifest.json` — for example `"https://192.168.1.10/*"` — and reload the extension.

## Usage

A **"模拟麦克风" (Fake Mic)** panel appears in the bottom-right corner of the page. It can be dragged anywhere and collapsed.

1. Click **+ 添加音频** (Add audio) or drag audio files straight onto the panel. Supported: mp3, wav, m4a, ogg, webm — you can select several at once. Clips are stored inside the extension, shared across all localhost pages, and survive page reloads.
2. Click a row to make it the **current clip**; use ↑ ↓ to reorder and ✕ to delete.
3. Start recording in the page. The extension plays the current clip automatically and advances to the next one when the recording ends — line up your clips and each round answers with the next one.

| Option | Effect |
| --- | --- |
| 启用模拟麦克风 (Enable fake mic) | When off, the page uses the real microphone |
| 录音开始自动播放 (Auto-play on record) | When off, start playback manually with **▶ 播放** or the shortcut — useful for simulating a pause before speaking |
| 录完切到下一段 (Advance after recording) | Select the next clip after each recording ends |
| 扬声器同时播放 (Monitor through speakers) | Play the clip through your speakers as well |
| 开始播放 (Playback trigger) | `MediaRecorder.start 时` (default): play when the page starts recording. `getUserMedia 返回时`: play as soon as the page obtains the microphone — for pages that don't use `MediaRecorder` (e.g. streaming recognition via AudioWorklet). In this mode, the page stopping the track counts as the recording ending |

Shortcuts (active on the page under test):

- `Option/Alt + →` / `Option/Alt + ←` — next / previous clip
- `Option/Alt + P` — play / stop. Pressing it mid-recording restarts the current clip

If the status line reads **"音频未激活，点一下面板"**, the browser's autoplay policy is blocking audio — click the panel once to resume.

## Known limitations

- **No `webkitSpeechRecognition` / `SpeechRecognition` support.** Those APIs read the system microphone directly and never go through `getUserMedia`.
- `enumerateDevices` and `navigator.permissions.query` are **not** patched — pages that inspect the device list or microphone permission state see the real thing.
- If a page hands the microphone stream to its own `AudioContext` and records the *processed* stream, the `MediaRecorder.start 时` trigger can't recognise the fake track. Use the `getUserMedia 返回时` trigger instead.
- The status line only reflects recordings in the top-level page. When recording happens inside an iframe the audio is still replaced and clips still advance, but the status line won't show "recording".
- Clips are stored as base64 in extension storage — keep individual files to tens of MB at most.

## Development & tests

```bash
npm install
npx playwright install chromium   # first run only
npm test
```

The test run boots a Chromium with the extension loaded, records on a test page served from `127.0.0.1:4321`, and analyses the frequency of the captured audio to verify three things:

- the recording contains the currently selected clip, and the track stays live after the clip finishes;
- recording completion advances to the next clip, so the following round captures the new one;
- with the extension disabled, the page gets the real microphone (Chrome's fake device).

## Files

- `manifest.json` — extension manifest (Manifest V3).
- `src/main-world.js` — runs in the page's main world: patches `getUserMedia`, watches `MediaRecorder` start/stop, plays clips through Web Audio.
- `src/panel.js` — runs in the isolated world: the floating panel, the clip library (`chrome.storage.local`) and shortcuts; talks to the main world over `window.postMessage`.
- `tests/` — Playwright end-to-end tests, the test page and a static server.

## License

[MIT](LICENSE)
