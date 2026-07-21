export type AidenConfig = {
  realtimeModel: string;
  realtimeVoice: string;
  activationShortcut: string;
  operatorShortcut: string;
  inactivityMs: number;
  transcriptionModel: string;
  transcriptionFallbackModel: string;
  transcriptionVocabulary: string[];
  summaryModel: string;
  visionModel: string;
  recapModel: string;
  recapImageModel: string;
  cameraId?: string;
  microphoneId?: string;
  cameraTimeoutMs: number;
  providerTimeoutMs: number;
  minimumFreeDiskMb: number;
  retentionDays: number;
  visionPath: "B";
  features: {
    computerUse: boolean;
    cameraVision: boolean;
    recap: boolean;
    directRealtimeVision: false;
  };
};

function enabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function enabledByDefault(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return enabled(value);
}

function envValue(env: NodeJS.ProcessEnv, primary: string, legacy: string): string | undefined {
  return env[primary] || env[legacy];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AidenConfig {
  const visionPath = (env.AIDEN_VISION_PATH || "B").toUpperCase();
  if (visionPath !== "B") throw new Error("AIDEN_VISION_PATH supports only path B (explicit main-process webcam vision).");
  return {
    realtimeModel: envValue(env, "AIDEN_REALTIME_MODEL", "RICKY_REALTIME_MODEL") || "gpt-realtime-2",
    realtimeVoice: envValue(env, "AIDEN_REALTIME_VOICE", "RICKY_REALTIME_VOICE") || "cedar",
    activationShortcut: envValue(env, "AIDEN_ACTIVATION_SHORTCUT", "RICKY_ACTIVATION_SHORTCUT") || "F9",
    operatorShortcut:
      envValue(env, "AIDEN_OPERATOR_SHORTCUT", "RICKY_OPERATOR_SHORTCUT") || "CommandOrControl+Shift+O",
    inactivityMs: positiveNumber(envValue(env, "AIDEN_INACTIVITY_MS", "RICKY_INACTIVITY_MS"), 20_000, 1_000),
    transcriptionModel:
      envValue(env, "AIDEN_TRANSCRIPTION_MODEL", "RICKY_TRANSCRIPTION_MODEL") || "gpt-4o-mini-transcribe",
    transcriptionFallbackModel:
      envValue(env, "AIDEN_TRANSCRIPTION_FALLBACK_MODEL", "RICKY_TRANSCRIPTION_FALLBACK_MODEL") || "whisper-1",
    transcriptionVocabulary: (envValue(env, "AIDEN_TRANSCRIPTION_NAMES", "RICKY_TRANSCRIPTION_NAMES") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    summaryModel: envValue(env, "AIDEN_SUMMARY_MODEL", "RICKY_SUMMARY_MODEL") || "gpt-4.1-mini",
    visionModel: env.AIDEN_VISION_MODEL || "gpt-4.1-mini",
    recapModel: env.AIDEN_RECAP_MODEL || "gpt-4.1-mini",
    recapImageModel: env.AIDEN_RECAP_IMAGE_MODEL || "gpt-image-2",
    cameraId: env.AIDEN_CAMERA_ID || undefined,
    microphoneId: env.AIDEN_MICROPHONE_ID || undefined,
    cameraTimeoutMs: positiveNumber(env.AIDEN_CAMERA_TIMEOUT_MS, 4_000, 3_000),
    providerTimeoutMs: positiveNumber(env.AIDEN_PROVIDER_TIMEOUT_MS, 30_000, 1_000),
    minimumFreeDiskMb: positiveNumber(env.AIDEN_MIN_FREE_DISK_MB, 512, 64),
    retentionDays: positiveNumber(env.AIDEN_RETENTION_DAYS, 30, 1),
    visionPath: "B",
    features: {
      computerUse: enabled(envValue(env, "AIDEN_ENABLE_COMPUTER_USE", "RICKY_ENABLE_COMPUTER_USE")),
      cameraVision: enabledByDefault(env.AIDEN_ENABLE_CAMERA_VISION, Boolean(env.OPENAI_API_KEY)),
      recap: enabledByDefault(env.AIDEN_ENABLE_RECAP, Boolean(env.OPENAI_API_KEY)),
      directRealtimeVision: false,
    },
  };
}

function positiveNumber(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}
