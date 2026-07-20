import { z } from "zod";

export const IPC_CHANNELS = {
  sessionActivate: "session:activate",
  sessionClose: "session:close",
  sessionAssistantSaid: "session:assistantSaid",
  sessionToggleRequested: "session:toggleRequested",
  audioChunk: "audio:chunk",
  audioCaptureState: "audio:captureState",
  transcriptAppended: "transcript:appended",
  toolCall: "tool:call",
  toolResult: "tool:result",
  opsState: "ops:state",
  opsSetBlock: "ops:setBlock",
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
  active: z.boolean(),
  capture: captureStateSchema,
  queue: z.object({
    depth: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    lastError: z.string().optional(),
    oldestPendingTs: z.number().nonnegative().optional(),
  }),
  warnings: z.array(z.string()),
});

export const opsSetBlockPayloadSchema = z.object({
  block: z.string().trim().min(1),
});

export type SessionActivatePayload = z.infer<typeof sessionActivatePayloadSchema>;
export type SessionActivateResult = z.infer<typeof sessionActivateResultSchema>;
export type SessionClosePayload = z.infer<typeof sessionClosePayloadSchema>;
export type AssistantSaidPayload = z.infer<typeof assistantSaidPayloadSchema>;
export type AudioChunkPayload = z.infer<typeof audioChunkPayloadSchema>;
export type CaptureState = z.infer<typeof captureStateSchema>;
export type TranscriptEntryEvent = z.infer<typeof transcriptEntryEventSchema>;
export type ToolCallPayload = z.infer<typeof toolCallPayloadSchema>;
export type ToolResultEvent = z.infer<typeof toolResultEventSchema>;
export type OpsStateEvent = z.infer<typeof opsStateEventSchema>;
export type OpsSetBlockPayload = z.infer<typeof opsSetBlockPayloadSchema>;

export function parseBoundary<T>(schema: z.ZodType<T>, payload: unknown): T {
  return schema.parse(payload);
}
