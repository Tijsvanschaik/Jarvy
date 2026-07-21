/// <reference types="vite/client" />

import type {
  AudioChunkPayload,
  AssistantSaidPayload,
  CaptureState,
  OpsSetBlockPayload,
  OpsHardClosePayload,
  OpsStateEvent,
  SessionActivatePayload,
  SessionActivateResult,
  SessionClosePayload,
  SessionPhasePayload,
  BoardState,
  CameraCaptureRequest,
  CameraCaptureResponse,
  DeckShowEvent,
  NoteAddedEvent,
  TranscriptEntryEvent,
  PreflightReport,
} from "./shared/ipc";
import type { AidenToolCall, AidenToolResult, AidenToolSpec, RecapDeck } from "./shared/types";

declare global {
  interface Window {
    aiden: {
      activateSession: (payload: SessionActivatePayload) => Promise<SessionActivateResult>;
      closeSession: (payload: SessionClosePayload) => Promise<void>;
      reportSessionPhase: (payload: SessionPhasePayload) => void;
      assistantSaid: (payload: AssistantSaidPayload) => void;
      submitAudioChunk: (payload: AudioChunkPayload) => void;
      reportCaptureState: (payload: CaptureState) => void;
      onSessionToggle: (listener: (source: "shortcut") => void) => () => void;
      onSessionHardClose: (listener: () => void) => () => void;
      executeTool: (toolCall: AidenToolCall) => Promise<AidenToolResult>;
      getToolSpecs: () => Promise<AidenToolSpec[]>;
      getFeatures: () => Promise<{
        computerUse: boolean;
        cameraVision: boolean;
        recap: boolean;
        directRealtimeVision: false;
        microphoneId?: string;
        cameraId?: string;
      }>;
      getOpsState: () => Promise<OpsStateEvent>;
      setOpsBlock: (payload: OpsSetBlockPayload) => Promise<OpsStateEvent>;
      hardCloseSession: (payload: OpsHardClosePayload) => Promise<OpsStateEvent>;
      openOperator: () => Promise<void>;
      onOpsState: (listener: (state: OpsStateEvent) => void) => () => void;
      onTranscriptAppended: (listener: (entry: TranscriptEntryEvent) => void) => () => void;
      getBoardState: () => Promise<BoardState>;
      onBoardPin: (listener: (state: BoardState) => void) => () => void;
      onNoteAdded: (listener: (note: NoteAddedEvent) => void) => () => void;
      onCameraCaptureRequest: (listener: (request: CameraCaptureRequest) => void) => () => void;
      respondCameraCapture: (response: CameraCaptureResponse) => void;
      onDeckShow: (listener: (event: DeckShowEvent) => void) => () => void;
      getRecapDeck: () => Promise<RecapDeck | null>;
      getPreflight: () => Promise<PreflightReport>;
      createRealtimeToken: () => Promise<{ value: string; expiresAt: number | null }>;
    };
  }
}

export {};
