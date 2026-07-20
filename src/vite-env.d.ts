/// <reference types="vite/client" />

import type {
  AssistantSaidPayload,
  OpsSetBlockPayload,
  OpsStateEvent,
  SessionActivatePayload,
  SessionActivateResult,
  SessionClosePayload,
} from "./shared/ipc";
import type { RickyToolCall, RickyToolResult, RickyToolSpec } from "./shared/types";

declare global {
  interface Window {
    ricky: {
      activateSession: (payload: SessionActivatePayload) => Promise<SessionActivateResult>;
      closeSession: (payload: SessionClosePayload) => Promise<void>;
      assistantSaid: (payload: AssistantSaidPayload) => void;
      onSessionToggle: (listener: (source: "shortcut") => void) => () => void;
      executeTool: (toolCall: RickyToolCall) => Promise<RickyToolResult>;
      getToolSpecs: () => Promise<RickyToolSpec[]>;
      getFeatures: () => Promise<{ computerUse: boolean }>;
      getOpsState: () => Promise<OpsStateEvent>;
      setOpsBlock: (payload: OpsSetBlockPayload) => Promise<OpsStateEvent>;
      createRealtimeToken: () => Promise<{ value: string; expiresAt: number | null }>;
    };
  }
}

export {};
