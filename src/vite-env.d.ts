/// <reference types="vite/client" />

import type {
  AudioChunkPayload,
  AssistantSaidPayload,
  CaptureState,
  OpsSetBlockPayload,
  OpsStateEvent,
  SessionActivatePayload,
  SessionActivateResult,
  SessionClosePayload,
  TranscriptEntryEvent,
} from "./shared/ipc";
import type { AidenToolCall, AidenToolResult, AidenToolSpec } from "./shared/types";

declare global {
  interface Window {
    aiden: {
      activateSession: (payload: SessionActivatePayload) => Promise<SessionActivateResult>;
      closeSession: (payload: SessionClosePayload) => Promise<void>;
      assistantSaid: (payload: AssistantSaidPayload) => void;
      submitAudioChunk: (payload: AudioChunkPayload) => void;
      reportCaptureState: (payload: CaptureState) => void;
      onSessionToggle: (listener: (source: "shortcut") => void) => () => void;
      executeTool: (toolCall: AidenToolCall) => Promise<AidenToolResult>;
      getToolSpecs: () => Promise<AidenToolSpec[]>;
      getFeatures: () => Promise<{ computerUse: boolean }>;
      getOpsState: () => Promise<OpsStateEvent>;
      setOpsBlock: (payload: OpsSetBlockPayload) => Promise<OpsStateEvent>;
      onOpsState: (listener: (state: OpsStateEvent) => void) => () => void;
      onTranscriptAppended: (listener: (entry: TranscriptEntryEvent) => void) => () => void;
      createRealtimeToken: () => Promise<{ value: string; expiresAt: number | null }>;
    };
  }
}

export {};
