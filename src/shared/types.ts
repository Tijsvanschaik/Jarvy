export type TranscriptRole = "user" | "ricky" | "system" | "tool";

export type TranscriptEntry = {
  id: string;
  role: TranscriptRole;
  text: string;
  at: string;
};

export type BlockSummary = {
  id: string;
  block: number;
  summary: string;
  createdAt: string;
};

export type OogstNotitie = {
  id: string;
  text: string;
  tags?: string[];
  createdAt: string;
};

export type Signaal = {
  id: string;
  kind: string;
  text: string;
  confidence?: number;
  createdAt: string;
};

export type RecapDeck = {
  id: string;
  title: string;
  slides: Array<{ title: string; body: string; visualPrompt?: string }>;
  createdAt: string;
};

export type RickyArtifact = {
  title: string;
  kind:
    | "text"
    | "markdown"
    | "code"
    | "table"
    | "notes"
    | "mermaid"
    | "image"
    | "imageLoading"
    | "thumbnailBoard"
    | "progress";
  content: string;
  language?: string;
  fullscreen?: boolean;
};

export type RickyToolSpec = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type RickyToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type RickyToolResult = {
  ok: boolean;
  artifact?: RickyArtifact;
  mode?: "display" | "computer";
  message?: string;
  error?: string;
  [key: string]: unknown;
};
