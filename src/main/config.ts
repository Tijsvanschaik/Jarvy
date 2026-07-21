export type RickyConfig = {
  realtimeModel: string;
  realtimeVoice: string;
  activationShortcut: string;
  operatorShortcut: string;
  inactivityMs: number;
  transcriptionModel: string;
  transcriptionFallbackModel: string;
  transcriptionVocabulary: string[];
  summaryModel: string;
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
    operatorShortcut: env.RICKY_OPERATOR_SHORTCUT || "CommandOrControl+Shift+O",
    inactivityMs: 20_000,
    transcriptionModel: env.RICKY_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
    transcriptionFallbackModel: env.RICKY_TRANSCRIPTION_FALLBACK_MODEL || "whisper-1",
    transcriptionVocabulary: (env.RICKY_TRANSCRIPTION_NAMES || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    summaryModel: env.RICKY_SUMMARY_MODEL || "gpt-4.1-mini",
    features: {
      computerUse: enabled(env.RICKY_ENABLE_COMPUTER_USE),
    },
  };
}
