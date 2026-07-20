import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  assistantSaidPayloadSchema,
  opsSetBlockPayloadSchema,
  sessionActivatePayloadSchema,
  sessionActivateResultSchema,
  sessionClosePayloadSchema,
  toolCallPayloadSchema,
  type AssistantSaidPayload,
  type OpsSetBlockPayload,
  type SessionActivatePayload,
  type SessionClosePayload,
  type ToolCallPayload,
} from "./shared/ipc";

contextBridge.exposeInMainWorld("ricky", {
  activateSession: async (payload: SessionActivatePayload) =>
    sessionActivateResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.sessionActivate, sessionActivatePayloadSchema.parse(payload)),
    ),
  closeSession: (payload: SessionClosePayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionClose, sessionClosePayloadSchema.parse(payload)),
  assistantSaid: (payload: AssistantSaidPayload) =>
    ipcRenderer.send(IPC_CHANNELS.sessionAssistantSaid, assistantSaidPayloadSchema.parse(payload)),
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
  getOpsState: () => ipcRenderer.invoke(IPC_CHANNELS.opsState),
  setOpsBlock: (payload: OpsSetBlockPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.opsSetBlock, opsSetBlockPayloadSchema.parse(payload)),

  // Transitional adapter for renderer code from before session:activate.
  createRealtimeToken: async () => {
    const result = sessionActivateResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.sessionActivate, { source: "ui" }),
    );
    return result.token;
  },
});
