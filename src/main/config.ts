export type AidenConfig = {
  realtimeModel: string;
  realtimeVoice: string;
  activationShortcut: string;
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

function envValue(env: NodeJS.ProcessEnv, primary: string, legacy: string): string | undefined {
  return env[primary] || env[legacy];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AidenConfig {
  return {
    realtimeModel: envValue(env, "AIDEN_REALTIME_MODEL", "RICKY_REALTIME_MODEL") || "gpt-realtime-2",
    realtimeVoice: envValue(env, "AIDEN_REALTIME_VOICE", "RICKY_REALTIME_VOICE") || "cedar",
    activationShortcut: envValue(env, "AIDEN_ACTIVATION_SHORTCUT", "RICKY_ACTIVATION_SHORTCUT") || "F9",
    inactivityMs: 20_000,
    transcriptionModel:
      envValue(env, "AIDEN_TRANSCRIPTION_MODEL", "RICKY_TRANSCRIPTION_MODEL") || "gpt-4o-mini-transcribe",
    transcriptionFallbackModel:
      envValue(env, "AIDEN_TRANSCRIPTION_FALLBACK_MODEL", "RICKY_TRANSCRIPTION_FALLBACK_MODEL") || "whisper-1",
    transcriptionVocabulary: (envValue(env, "AIDEN_TRANSCRIPTION_NAMES", "RICKY_TRANSCRIPTION_NAMES") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    summaryModel: envValue(env, "AIDEN_SUMMARY_MODEL", "RICKY_SUMMARY_MODEL") || "gpt-4.1-mini",
    features: {
      computerUse: enabled(envValue(env, "AIDEN_ENABLE_COMPUTER_USE", "RICKY_ENABLE_COMPUTER_USE")),
    },
  };
}
