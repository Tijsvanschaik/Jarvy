export type RickyConfig = {
  realtimeModel: string;
  realtimeVoice: string;
  activationShortcut: string;
  inactivityMs: number;
  features: {
    computerUse: boolean;
  };
};

function enabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RickyConfig {
  return {
    // Keep provider choices centralized; these defaults match the working app.
    realtimeModel: env.RICKY_REALTIME_MODEL || "gpt-realtime-2",
    realtimeVoice: env.RICKY_REALTIME_VOICE || "cedar",
    activationShortcut: env.RICKY_ACTIVATION_SHORTCUT || "F9",
    inactivityMs: 20_000,
    features: {
      computerUse: enabled(env.RICKY_ENABLE_COMPUTER_USE),
    },
  };
}
