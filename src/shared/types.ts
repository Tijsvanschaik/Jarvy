export type TranscriptEntry = {
  id: string;
  tsStart: number;
  tsEnd: number;
  text: string;
  source: "room" | "assistant";
  block?: string;
  chunkFile?: string;
};

export type BlockSummary = {
  id: string;
  block: string;
  summary: string;
  createdAt: string;
  coversUntil: number;
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

export type AidenArtifact = {
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

export type AidenToolSpec = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AidenToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type AidenToolResult = {
  ok: boolean;
  artifact?: AidenArtifact;
  mode?: "display" | "computer";
  message?: string;
  error?: string;
  [key: string]: unknown;
};
