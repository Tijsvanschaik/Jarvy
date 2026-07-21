const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aiden", {
  createRealtimeToken: () => ipcRenderer.invoke("realtime:create-token"),
  executeTool: (toolCall) => ipcRenderer.invoke("tools:execute", toolCall),
  getToolSpecs: () => ipcRenderer.invoke("tools:list"),
});
