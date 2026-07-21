# Session-day runbook

Before participants enter:

- Display and read the consent notice: room audio is locally chunked and sent for transcription; webcam capture occurs only on an explicit cue; participants may opt out or request cleanup.
- Set provider spend limits and confirm the account quota. Never paste keys into chat/logs.
- Prefer wired internet; test the 5G backup. Run `npm run preflight`.
- Test microphone level/VAD, camera once with consent, output audio, `F9`, operator shortcut/button, and hard close.
- Confirm queue depth returns to zero, free disk is sufficient, block 1 is selected, and the five-routine offline `npm run rehearsal` passes.

Routine cues:

1. Introduction: activate explicitly; request the short introduction and visual CV artifact.
2. Layer 1: request the local sample signal, verify `zoek_signaal` precedes any web fallback, then pin it.
3. Layer 2: state that this routine is provisional. There is no municipal system; do not simulate one.
4. Camera: obtain consent, explicitly request one frame, and ask for one factual observation connected to prior transcript.
5. Recap: save evidence-backed notes, announce brief thinking, start recap, and verify unsupported participant claims are absent.

During the session, monitor queue errors/depth, current block, context budget, prompt warnings, recap progress, and network latency. Switch blocks in the operator window at each programme boundary.

Emergency: click **Hard close session**. This closes Realtime and releases its branch; on application quit Aiden stops new audio, persists queue state, cancels providers, releases media, timers, shortcuts, and windows.

Afterward:

1. Wait for queue depth zero where network conditions allow.
2. Review the recap evidence and export only the agreed day: `npm run session:export -- --date YYYY-MM-DD --output ./exports/YYYY-MM-DD`. Audio requires explicit `--include-audio`.
3. Preview retention cleanup: `npm run session:cleanup -- --older-than 30`. Apply only after review with `--confirm`.
4. Confirm consent scope, participant deletion requests, export recipient/location, raw-audio choice, retention date, and secure deletion of temporary copies.
