import { z } from "zod";
import { boardPinSchema, boardStateSchema, oogstNotitieSchema } from "./schemas";

export const IPC_CHANNELS = {
  sessionActivate: "session:activate",
  sessionClose: "session:close",
  sessionAssistantSaid: "session:assistantSaid",
  sessionToggleRequested: "session:toggleRequested",
  sessionHardCloseRequested: "session:hardCloseRequested",
  sessionPhase: "session:phase",
  audioChunk: "audio:chunk",
  audioCaptureState: "audio:captureState",
  transcriptAppended: "transcript:appended",
  toolCall: "tool:call",
  toolResult: "tool:result",
  opsState: "ops:state",
  opsSetBlock: "ops:setBlock",
  opsHardClose: "ops:hardClose",
  boardPin: "board:pin",
  boardState: "board:state",
  noteAdded: "note:added",
  featuresGet: "features:get",
} as const;

export const contextSectionUsageSchema = z.object({
  id: z.string(),
  tokens: z.number().int().nonnegative(),
  budget: z.number().int().positive(),
  truncated: z.boolean(),
});

export const sessionActivatePayloadSchema = z.object({
  source: z.enum(["ui", "shortcut"]),
});

export const sessionActivateResultSchema = z.object({
  token: z.object({
    value: z.string().min(1),
    expiresAt: z.number().nullable(),
  }),
  context: z.object({
    totalTokens: z.number().int().nonnegative(),
    sections: z.array(contextSectionUsageSchema),
    warnings: z.array(z.string()),
  }),
});

export const sessionClosePayloadSchema = z.object({
  reason: z.enum(["ui", "shortcut", "inactivity", "error", "window"]),
});

export const assistantSaidPayloadSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  at: z.string().min(1),
});

export const sessionPhasePayloadSchema = z.object({
  state: z.enum(["open", "listening", "speaking"]),
});

export const audioChunkPayloadSchema = z
  .object({
    wav: z.custom<ArrayBuffer>(
      (value) => value instanceof ArrayBuffer && value.byteLength >= 44 && value.byteLength <= 64 * 1024 * 1024,
      "Expected a bounded WAV ArrayBuffer.",
    ),
    tsStart: z.number().finite().nonnegative(),
    tsEnd: z.number().finite().nonnegative(),
  })
  .refine((value) => value.tsEnd > value.tsStart, "Audio chunk end must follow its start.");

export const captureStateSchema = z.object({
  capture: z.enum(["stopped", "starting", "capturing", "muted", "error"]),
  vadSpeech: z.boolean(),
  level: z.number().min(0).max(1).default(0),
  deviceId: z.string().optional(),
  error: z.string().optional(),
});

export const transcriptEntryEventSchema = z.object({
  id: z.string().min(1),
  tsStart: z.number().finite().nonnegative(),
  tsEnd: z.number().finite().nonnegative(),
  text: z.string().min(1),
  source: z.enum(["room", "assistant"]),
  block: z.string().optional(),
  chunkFile: z.string().optional(),
});

export const toolCallPayloadSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});

export const toolResultEventSchema = z.object({
  callId: z.string().min(1),
  result: z.record(z.string(), z.unknown()),
});

export const opsStateEventSchema = z.object({
  block: z.string().min(1),
  session: z.object({
    state: z.enum(["idle", "open", "listening", "speaking"]),
    active: z.boolean(),
    openedAt: z.number().nonnegative().optional(),
    durationMs: z.number().nonnegative(),
    inactivityRemainingMs: z.number().nonnegative().optional(),
  }),
  capture: captureStateSchema,
  queue: z.object({
    depth: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    lastError: z.string().optional(),
    oldestPendingTs: z.number().nonnegative().optional(),
  }),
  transcript: z.array(transcriptEntryEventSchema).max(15),
  context: z.object({
    totalTokens: z.number().int().nonnegative(),
    sections: z.array(contextSectionUsageSchema),
    warnings: z.array(z.string()),
  }).optional(),
  notesCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export const opsSetBlockPayloadSchema = z.object({
  block: z.string().trim().min(1),
});

export const opsHardClosePayloadSchema = z.object({
  reason: z.literal("operator").default("operator"),
});

export type SessionActivatePayload = z.infer<typeof sessionActivatePayloadSchema>;
export type SessionActivateResult = z.infer<typeof sessionActivateResultSchema>;
export type SessionClosePayload = z.infer<typeof sessionClosePayloadSchema>;
export type AssistantSaidPayload = z.infer<typeof assistantSaidPayloadSchema>;
export type SessionPhasePayload = z.infer<typeof sessionPhasePayloadSchema>;
export type AudioChunkPayload = z.infer<typeof audioChunkPayloadSchema>;
export type CaptureState = z.infer<typeof captureStateSchema>;
export type TranscriptEntryEvent = z.infer<typeof transcriptEntryEventSchema>;
export type ToolCallPayload = z.infer<typeof toolCallPayloadSchema>;
export type ToolResultEvent = z.infer<typeof toolResultEventSchema>;
export type OpsStateEvent = z.infer<typeof opsStateEventSchema>;
export type OpsSetBlockPayload = z.infer<typeof opsSetBlockPayloadSchema>;
export type OpsHardClosePayload = z.infer<typeof opsHardClosePayloadSchema>;
export type BoardState = z.infer<typeof boardStateSchema>;
export type BoardPinEvent = z.infer<typeof boardPinSchema>;
export type NoteAddedEvent = z.infer<typeof oogstNotitieSchema>;

export function parseBoundary<T>(schema: z.ZodType<T>, payload: unknown): T {
  return schema.parse(payload);
}
