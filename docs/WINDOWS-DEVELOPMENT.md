# Windows development

Use Node.js 20 or newer, Git, and npm. Clone the repository, copy `.env.example` to `.env.local`, and run `npm ci`.

Run `npm run verify` before a session. It needs no keys, network, or hardware. Run `npm run preflight` separately for configured provider reachability; it never generates or transcribes. Start with `npm run dev`.

Windows checks:

1. Allow desktop applications and Electron under Settings → Privacy & security → Microphone and Camera.
2. Set `AIDEN_MICROPHONE_ID` / `AIDEN_CAMERA_ID` only when the default devices are wrong.
3. Test `F9`, the visible power button, `Ctrl+Shift+O`, and the visible operator button. Shortcut registration failure is shown to the operator and does not remove manual controls.
4. Keep the operator window on the facilitator display and the Aiden window on the presentation display.

If audio is unavailable, close applications holding the device, clear an obsolete device ID, and restart. If provider checks report auth, quota, network, or model errors, follow that category rather than retrying paid calls.
