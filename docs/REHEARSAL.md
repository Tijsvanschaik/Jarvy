# Rehearsal

## Offline acceptance rehearsal

Run:

```bash
npm ci
npm run rehearsal
```

The command generates privacy-safe tones/silence in a temporary directory and uses `fixtures/rehearsal.json`. It exercises WAV parsing, energy VAD/chunking, disk queue, transcript store, summaries, bounded activation context, scripted tools/notes/board, fake camera vision, recap cache/deck/images, and evidence filtering. It exits nonzero unless all five routines pass. No key, network, microphone, camera, voice, or paid call is used.

For another PCM16 mono file:

```bash
npm run replay -- --file sample.wav --speed 2 --block rehearsal
npm run replay -- --file sample.wav --offline-fixtures fixtures/rehearsal.json
```

Reports omit audio, keys, prompts, and transcript text. Add `--debug-transcripts` only during an approved local debugging session.

## Live general rehearsal

Run preflight, verify provider spend limits, obtain consent, and follow the five cues in `SESSION-DAY-RUNBOOK.md`. Confirm manual controls work even if global shortcuts fail. Test camera only through the explicit routine-4 cue. Verify queue drain, recap evidence, export without audio, dry-run cleanup, and hard close.
