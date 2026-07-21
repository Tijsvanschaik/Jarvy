# macOS transfer

1. Install Node.js 20+ (for example with the official installer or Homebrew) and Git.
2. `git clone https://github.com/Tijsvanschaik/Jarvy.git && cd Jarvy`
3. `cp .env.example .env.local`, configure keys locally, then run `npm ci`.
4. Run `npm run verify`, `npm run preflight`, and `npm run build`.
5. Start with `npm run dev` or `npm start`.

On first explicit microphone/camera use, approve Aiden/Electron in System Settings → Privacy & Security → Microphone or Camera. Aiden checks status through Electron on macOS. It does not request Accessibility or Screen Recording. The camera remains off until `kijk_mee`; room capture starts only through the visible Room control or explicit activation.

Device and room setup:

- Leave `AIDEN_MICROPHONE_ID` and `AIDEN_CAMERA_ID` empty to use system defaults; set stable IDs only after testing.
- Test `F9`, `Cmd+Shift+O`, the power button, and the operator button. If a shortcut is reserved by macOS/another app, choose another Electron accelerator in `.env.local`.
- Put Aiden on the audience display and the operator window on the facilitator display.
- Use wired networking when possible, otherwise tested 5G/Wi-Fi. Confirm provider latency in preflight.

Troubleshooting:

- `denied`: grant only Microphone/Camera permission and restart Electron.
- `not found`: remove stale device IDs and reconnect hardware.
- `busy`: close conferencing/camera applications.
- auth/quota/model/network: follow the precise preflight category.
- No shortcut: use visible controls and choose a different accelerator.
