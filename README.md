# Aiden

Aiden is a local Electron desktop participant with always-on room transcription, activation-only realtime voice, a visual signal board, image generation, web search, structured oogst notes, and a separate operator console. Development is Windows-first; macOS remains compatible.

It is built with Electron, React, Vite, TypeScript, and the OpenAI Realtime API.

## Features

- Realtime speech-to-speech conversation with OpenAI Realtime.
- Animated companion face with listening, thinking, speaking, and working states.
- Artifact panel with a persistent domain-based signal board.
- Separate operator window with transcript, microphone/VAD, queue, activation, context-budget, block, and warning status.
- Optional Exa-powered web search.
- Append-only structured notes stored at runtime under `data/oogst/notities.jsonl`.
- Global `F9` activation toggle (configurable with `AIDEN_ACTIVATION_SHORTCUT`) plus the same lifecycle from the power button.
- Explicit-consent shared microphone capture with local PCM/VAD chunking, persistent transcription queue, and daily JSONL transcripts.
- Computer-use code is retained but its UI and Realtime tools are disabled by default.

## Requirements

- Windows for current development (macOS remains compatible)
- Node.js 20+
- npm
- An OpenAI API key with Realtime and image generation access
- Optional: an Exa API key for web search

## Quick Start

```bash
git clone https://github.com/Tijsvanschaik/Jarvy.git
cd Jarvy
npm install
cp .env.example .env.local
npm run dev
```

Edit `.env.local` before starting voice features:

```bash
OPENAI_API_KEY=your_openai_api_key_here
EXA_API_KEY=your_exa_api_key_here
```

`OPENAI_API_KEY` is required. `EXA_API_KEY` is optional; web search will show a setup message when it is missing. Keys are read only by the Electron main process.

## Activation flow

Press `F9` or click the power button. That explicit action starts the shared room microphone (if it is not already running), while the main process reloads prompts, builds bounded context, and mints an ephemeral token through the GA `/v1/realtime/client_secrets` endpoint. Realtime receives a cloned microphone track.

A second toggle closes the peer connection, data channel, and cloned Realtime track without stopping ambient room capture. A resettable 20-second inactivity timer does the same. Aiden never opens Realtime without explicit activation and has no wake word.

## Operator window

Press `Ctrl+Shift+O` on Windows/Linux or `Cmd+Shift+O` on macOS to show or hide the separate operator window. Override this with `AIDEN_OPERATOR_SHORTCUT`. In development it opens by default. The window uses the same isolated typed preload bridge as the main window; it never reads runtime files directly.

The operator can change the current block and issue an emergency hard close. Status snapshots are aggregated in main and broadcast at no more than 2 Hz. No raw audio or API keys are included.

## Signal library and board

The tracked, explicitly non-authoritative sample library is `assets/signalen/bibliotheek.sample.json`. On first run it is copied to the editable ignored file `data/signalen/bibliotheek.json`. Cards are validated on startup and tool lookup with this exact shape:

`id`, `titel`, `laag` (`1|2|3`), `domein` (`zorg|mobiliteit|sociaal|energie|algemeen`), `type` (`hard|zacht`), `kernfeit`, `bron`, `jaar`, `beleidsvraag`, `uitlegKort`, and optional `afbeelding`.

IDs must be lowercase slugs and unique. Invalid libraries fail validation; duplicate IDs are skipped with an operator warning. The complete compact index is generated dynamically in the `zoek_signaal` Realtime tool description.

Pins are atomically persisted to `data/signalen/board-state.json` and restored after restart. The board stores signal snapshots or local image paths, never base64 image blobs. Tool calls update the main artifact panel quietly.

## Oogst notes

`maak_notitie` appends crash-safely to `data/oogst/notities.jsonl`. Main assigns the UUID, ISO timestamp, and current ConfigStore block. Corrupt lines are skipped with an operator warning. Valid notes feed the bounded ContextBuilder oogst section on the next activation.

## Demo routine 2 rehearsal

1. Activate Aiden with `F9`.
2. Ask: “Laat het laag-1 demosignaal voor routine 2 zien.”
3. Aiden deterministically calls `zoek_signaal` with `demo-laag-1-buurtcheck`.
4. Ask Aiden to pin it, or explicitly request `toon_op_bord` with domein `sociaal`.
5. Confirm the card appears in the non-modal signal board and remains after restart.

Prompt and tool descriptions require local `zoek_signaal` before `zoek_web` for example requests. Sample cards clearly state that they are not authoritative claims.

## Room transcription

Room capture is mono 16 kHz PCM internally and writes PCM16 WAV chunks under `data/audio/chunks/` before queueing any API request. The explicit thresholds are 300 ms pre-roll, 700 ms closing silence after a minimum 5-second chunk, 30-second hard cap, and a minimum one second of detected speech. Aiden output pauses ambient chunking and capture resumes 500 ms after playback.

This milestone ships an explicit energy-based VAD fallback. It does not claim Silero behavior. A local `@ricky0123/vad-web`/ONNX asset integration remains follow-up because adding it here would make Electron/Vite asset loading less reliable; there is no CDN dependency.

Queue jobs are persisted, recovered after restart, processed FIFO with concurrency two, retried for transient failures, and transcribed in Dutch with `gpt-4o-mini-transcribe`. `whisper-1` is used only for model-related unsupported/not-found responses. Add event-specific names with comma-separated `AIDEN_TRANSCRIPTION_NAMES`.

## Prompts

Tracked Dutch defaults live in `prompts/`:

- `persona.md`
- `gedragsregels.md`
- `demo-modi.md`
- `sessiebrief.md`

On startup, missing files are copied to ignored runtime storage at `data/prompts/`. Edit the runtime copies for local sessions; they are read fresh on every activation and are never overwritten by bootstrap.

## Feature flags

Computer-use implementation is retained only as transitional code and defaults to off. The active ToolHost exposes only `zoek_signaal`, `toon_op_bord`, `maak_notitie`, `genereer_beeld`, and `zoek_web`. Computer-use and old thumbnail tools are not advertised or executable through Realtime, and no Accessibility or Screen Recording flow is started. `kijk_mee` and `start_recap` exist only as disabled internal stubs for the next milestone.

Use `AIDEN_ENABLE_COMPUTER_USE=true` only for transitional testing. Legacy `RICKY_*` environment variables remain supported as fallbacks during the rename.

## Development

```bash
npm run dev
```

This starts Vite on `127.0.0.1:5173` and launches Electron.

Other useful commands:

```bash
npm test
npm run typecheck
npm run build
npm run build:electron
npm start
```

The Electron build bundles the typed preload and modular main foundations with esbuild. `electron/main.cjs` remains a transitional adapter containing reusable legacy image helpers, but active Realtime tool specs and invocation come only from the typed registry under `src/main/`.

## Runtime Data

The app creates a repo-local `data/` directory for runtime prompts, audio chunks/queue state, daily transcript JSONL, summaries, oogst notes, the signal library/board state, and generated images. Repo-local storage is an explicit product requirement and the directory is intentionally ignored by Git.

Do not commit:

- `.env.local`
- Anything under `data/`
- `dist/`
- `node_modules/`

## Security Notes

- API keys are loaded only from local environment files.
- `.env.local` and all `.env.*` files are ignored except `.env.example`.
- Generated images and local database files are ignored.
- Computer-use helpers are inactive transitional code and are absent from active tool specs.

Before publishing a fork, run:

```bash
npm run typecheck
npm test
npm run build
git status --short
```

Then verify that no local secrets or runtime data are staged.

## Next milestone

The exact next milestone is: **webcam vision + recap map-reduce + routines 4/5**.

## License

MIT
