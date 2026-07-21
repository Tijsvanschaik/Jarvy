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
  deelnemer?: string;
  type: "inzicht" | "aanname" | "vraag" | "vervolgstap" | "dilemma";
  tekst: string;
  block: string;
  timestamp: string;
};

export type Signaal = {
  id: string;
  titel: string;
  laag: 1 | 2 | 3;
  domein: "zorg" | "mobiliteit" | "sociaal" | "energie" | "algemeen";
  type: "hard" | "zacht";
  kernfeit: string;
  bron: string;
  jaar: string;
  beleidsvraag: string;
  uitlegKort: string;
  afbeelding?: string;
};

export type BoardPin = {
  id: string;
  signaalId?: string;
  beeldPad?: string;
  domein: Signaal["domein"];
  notitie?: string;
  pinnedAt: string;
  signaal?: Signaal;
};

export type RecapDeck = {
  id: string;
  slides: Array<{
    id: string;
    soort: "blok" | "deelnemer" | "slot";
    titel: string;
    bullets: string[];
    beeldPrompt?: string;
    beeldPad?: string;
  }>;
  createdAt: string;
};

export type CameraFrame = {
  mediaType: "image/jpeg";
  data: string;
  width: number;
  height: number;
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
    | "signalBoard"
    | "recapDeck"
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
