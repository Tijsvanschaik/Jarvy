import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  audioChunkPayloadSchema,
  assistantSaidPayloadSchema,
  captureStateSchema,
  opsStateEventSchema,
  opsSetBlockPayloadSchema,
  sessionActivatePayloadSchema,
  sessionActivateResultSchema,
  sessionClosePayloadSchema,
  toolCallPayloadSchema,
  transcriptEntryEventSchema,
  type AudioChunkPayload,
  type AssistantSaidPayload,
  type CaptureState,
  type OpsSetBlockPayload,
  type SessionActivatePayload,
  type SessionClosePayload,
  type ToolCallPayload,
  type TranscriptEntryEvent,
} from "./shared/ipc";

contextBridge.exposeInMainWorld("aiden", {
  activateSession: async (payload: SessionActivatePayload) =>
    sessionActivateResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.sessionActivate, sessionActivatePayloadSchema.parse(payload)),
    ),
  closeSession: (payload: SessionClosePayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionClose, sessionClosePayloadSchema.parse(payload)),
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
  executeTool: (toolCall: ToolCallPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.toolCall, toolCallPayloadSchema.parse(toolCall)),
  getToolSpecs: () => ipcRenderer.invoke("tools:list"),
  getFeatures: () => ipcRenderer.invoke(IPC_CHANNELS.featuresGet),
  getOpsState: async () => opsStateEventSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.opsState)),
  setOpsBlock: async (payload: OpsSetBlockPayload) =>
    opsStateEventSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.opsSetBlock, opsSetBlockPayloadSchema.parse(payload)),
    ),
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

  // Transitional adapter for renderer code from before session:activate.
  createRealtimeToken: async () => {
    const result = sessionActivateResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.sessionActivate, { source: "ui" }),
    );
    return result.token;
  },
});
