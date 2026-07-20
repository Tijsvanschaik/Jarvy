# Ricky

Ricky is a local Electron desktop participant with always-on room transcription, activation-only realtime voice, a visual artifact panel, image generation, web search, notes, and records. Development is Windows-first; the later production target is macOS.

It is built with Electron, React, Vite, TypeScript, and the OpenAI Realtime API.

## Features

- Realtime speech-to-speech conversation with OpenAI Realtime.
- Animated companion face with listening, thinking, speaking, and working states.
- Artifact panel for markdown, menus, notes, Mermaid diagrams, generated images, records, and progress.
- YouTube thumbnail board with persistent numbered generations and image edits.
- Optional Exa-powered web search.
- Local notes and records stored at runtime under `data/`.
- Global `F9` activation toggle (configurable with `RICKY_ACTIVATION_SHORTCUT`) plus the same lifecycle from the power button.
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
git clone https://github.com/rileybrown/rileyjarvis.git
cd rileyjarvis
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

A second toggle closes the peer connection, data channel, and cloned Realtime track without stopping ambient room capture. A resettable 20-second inactivity timer does the same. Ricky never opens Realtime without explicit activation and has no wake word.

## Room transcription

Room capture is mono 16 kHz PCM internally and writes PCM16 WAV chunks under `data/audio/chunks/` before queueing any API request. The explicit thresholds are 300 ms pre-roll, 700 ms closing silence after a minimum 5-second chunk, 30-second hard cap, and a minimum one second of detected speech. Ricky output pauses ambient chunking and capture resumes 500 ms after playback.

This milestone ships an explicit energy-based VAD fallback. It does not claim Silero behavior. A local `@ricky0123/vad-web`/ONNX asset integration remains follow-up because adding it here would make Electron/Vite asset loading less reliable; there is no CDN dependency.

Queue jobs are persisted, recovered after restart, processed FIFO with concurrency two, retried for transient failures, and transcribed in Dutch with `gpt-4o-mini-transcribe`. `whisper-1` is used only for model-related unsupported/not-found responses. Add event-specific names with comma-separated `RICKY_TRANSCRIPTION_NAMES`.

## Prompts

Tracked Dutch defaults live in `prompts/`:

- `persona.md`
- `gedragsregels.md`
- `demo-modi.md`
- `sessiebrief.md`

On startup, missing files are copied to ignored runtime storage at `data/prompts/`. Edit the runtime copies for local sessions; they are read fresh on every activation and are never overwritten by bootstrap.

## Feature flags

Computer use defaults to off. To expose its mode control and tools explicitly:

```bash
RICKY_ENABLE_COMPUTER_USE=true
```

When disabled, Ricky does not advertise or execute computer-control tools and does not request Accessibility or Screen Recording permissions.

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

The Electron build bundles the typed preload and modular main foundations with esbuild. `electron/main.cjs` remains a transitional adapter around the existing tool implementation; new session, prompt, context, configuration, and validation code lives under `src/main/`.

## Runtime Data

The app creates a repo-local `data/` directory for runtime prompts, audio chunks/queue state, daily transcript JSONL, summaries, notes, records, generated images, and thumbnail-board state. Repo-local storage is an explicit product requirement and the directory is intentionally ignored by Git.

Do not commit:

- `.env.local`
- Anything under `data/`
- `dist/`
- `node_modules/`

## Security Notes

- API keys are loaded only from local environment files.
- `.env.local` and all `.env.*` files are ignored except `.env.example`.
- Generated images and local database files are ignored.
- Computer use is an opt-in development feature and risky actions still require explicit confirmation.

Before publishing a fork, run:

```bash
npm run typecheck
npm test
npm run build
git status --short
```

Then verify that no local secrets or runtime data are staged.

## Next milestone

The exact next milestone is: **full operator BrowserWindow + signal board/tool registry**.

## License

MIT
