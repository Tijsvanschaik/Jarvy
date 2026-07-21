import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  audioChunkPayloadSchema,
  assistantSaidPayloadSchema,
  captureStateSchema,
  cameraCaptureRequestSchema,
  cameraCaptureResponseSchema,
  deckShowEventSchema,
  opsStateEventSchema,
  opsHardClosePayloadSchema,
  opsSetBlockPayloadSchema,
  preflightReportSchema,
  sessionActivatePayloadSchema,
  sessionActivateResultSchema,
  sessionClosePayloadSchema,
  sessionPhasePayloadSchema,
  toolCallPayloadSchema,
  transcriptEntryEventSchema,
  type AudioChunkPayload,
  type AssistantSaidPayload,
  type CaptureState,
  type CameraCaptureResponse,
  type CameraCaptureRequest,
  type DeckShowEvent,
  type OpsSetBlockPayload,
  type OpsHardClosePayload,
  type SessionActivatePayload,
  type SessionClosePayload,
  type SessionPhasePayload,
  type ToolCallPayload,
  type TranscriptEntryEvent,
} from "./shared/ipc";
import { boardStateSchema, oogstNotitieSchema, recapDeckSchema } from "./shared/schemas";

contextBridge.exposeInMainWorld("aiden", {
  activateSession: async (payload: SessionActivatePayload) =>
    sessionActivateResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.sessionActivate, sessionActivatePayloadSchema.parse(payload)),
    ),
  closeSession: (payload: SessionClosePayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionClose, sessionClosePayloadSchema.parse(payload)),
  reportSessionPhase: (payload: SessionPhasePayload) =>
    ipcRenderer.send(IPC_CHANNELS.sessionPhase, sessionPhasePayloadSchema.parse(payload)),
  assistantSaid: (payload: AssistantSaidPayload) =>
    ipcRenderer.send(IPC_CHANNELS.sessionAssistantSaid, assistantSaidPayloadSchema.parse(payload)),
  submitAudioChunk: (payload: AudioChunkPayload) =>
    ipcRenderer.send(IPC_CHANNELS.audioChunk, audioChunkPayloadSchema.parse(payload)),
  reportCaptureState: (payload: CaptureState) =>
    ipcRenderer.send(IPC_CHANNELS.audioCaptureState, captureStateSchema.parse(payload)),
  onSessionToggle: (listener: (source: "shortcut") => void) => {
    const handler = (_event: Electron.IpcRendererEvent, source: unknown) => {
      if (source === "shortcut") listener(source);
    };
    ipcRenderer.on(IPC_CHANNELS.sessionToggleRequested, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sessionToggleRequested, handler);
  },
  onSessionHardClose: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on(IPC_CHANNELS.sessionHardCloseRequested, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.sessionHardCloseRequested, handler);
  },
  executeTool: (toolCall: ToolCallPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.toolCall, toolCallPayloadSchema.parse(toolCall)),
  getToolSpecs: () => ipcRenderer.invoke("tools:list"),
  getFeatures: () => ipcRenderer.invoke(IPC_CHANNELS.featuresGet),
  getOpsState: async () => opsStateEventSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.opsState)),
  setOpsBlock: async (payload: OpsSetBlockPayload) =>
    opsStateEventSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.opsSetBlock, opsSetBlockPayloadSchema.parse(payload)),
    ),
  hardCloseSession: async (payload: OpsHardClosePayload) =>
    opsStateEventSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.opsHardClose, opsHardClosePayloadSchema.parse(payload)),
    ),
  openOperator: () => ipcRenderer.invoke(IPC_CHANNELS.opsOpenOperator),
  onOpsState: (listener: (state: ReturnType<typeof opsStateEventSchema.parse>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(opsStateEventSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.opsState, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.opsState, handler);
  },
  onTranscriptAppended: (listener: (entry: TranscriptEntryEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      listener(transcriptEntryEventSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.transcriptAppended, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.transcriptAppended, handler);
  },
  getBoardState: async () => boardStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.boardState)),
  onBoardPin: (listener: (state: ReturnType<typeof boardStateSchema.parse>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(boardStateSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.boardPin, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.boardPin, handler);
  },
  onNoteAdded: (listener: (note: ReturnType<typeof oogstNotitieSchema.parse>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(oogstNotitieSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.noteAdded, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.noteAdded, handler);
  },
  onCameraCaptureRequest: (listener: (request: CameraCaptureRequest) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      listener(cameraCaptureRequestSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.cameraCaptureRequest, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.cameraCaptureRequest, handler);
  },
  respondCameraCapture: (response: CameraCaptureResponse) =>
    ipcRenderer.send(IPC_CHANNELS.cameraCaptureResponse, cameraCaptureResponseSchema.parse(response)),
  onDeckShow: (listener: (event: DeckShowEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(deckShowEventSchema.parse(payload));
    ipcRenderer.on(IPC_CHANNELS.deckShow, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.deckShow, handler);
  },
  getRecapDeck: async () => recapDeckSchema.nullable().parse(await ipcRenderer.invoke(IPC_CHANNELS.deckState)),
  getPreflight: async () => preflightReportSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.preflightGet)),

  // Transitional adapter for renderer code from before session:activate.
  createRealtimeToken: async () => {
    const result = sessionActivateResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.sessionActivate, { source: "ui" }),
    );
    return result.token;
  },
});
