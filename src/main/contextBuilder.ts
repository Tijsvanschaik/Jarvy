import type { BlockSummary, OogstNotitie, TranscriptEntry } from "../shared/types";
import type { PromptLoader } from "./promptLoader";
import { estimateTokens } from "./tokenEstimate";

export const CONTEXT_BUDGETS = {
  static: 2_000,
  sessionBrief: 800,
  summaries: 1_200,
  transcript: 3_000,
  notes: 1_000,
} as const;

export type ContextProviders = {
  summaries: { list: () => Promise<BlockSummary[]> };
  transcript: { recent: () => Promise<TranscriptEntry[]> };
  notes: { list: () => Promise<OogstNotitie[]> };
};

export type ContextSectionUsage = {
  id: keyof typeof CONTEXT_BUDGETS;
  tokens: number;
  budget: number;
  truncated: boolean;
};

export type BuiltContext = {
  instructions: string;
  totalTokens: number;
  sections: ContextSectionUsage[];
  warnings: string[];
};

type RenderedSection = {
  id: keyof typeof CONTEXT_BUDGETS;
  title: string;
  body: string;
  truncated: boolean;
};

export class ContextBuilder {
  constructor(
    private readonly prompts: PromptLoader,
    private readonly providers: ContextProviders,
  ) {}

  async build(): Promise<BuiltContext> {
    const [promptSet, summaries, transcript, notes] = await Promise.all([
      this.prompts.loadFresh(),
      this.providers.summaries.list(),
      this.providers.transcript.recent(),
      this.providers.notes.list(),
    ]);

    const staticBody = [promptSet["persona.md"], promptSet["gedragsregels.md"], promptSet["demo-modi.md"]]
      .filter(Boolean)
      .join("\n\n");
    const summary = fitLines(
      summaries.map((item) => `[Blok ${item.block}] ${item.summary}`),
      CONTEXT_BUDGETS.summaries,
    );
    const literal = fitLines(
      transcript.map((item) => `[${item.at}] ${item.role}: ${item.text}`),
      CONTEXT_BUDGETS.transcript,
    );
    const noteSection = renderNotes(notes);

    const rendered: RenderedSection[] = [
      { id: "static", title: "Persona, gedragsregels en demo-modi", body: staticBody, truncated: false },
      { id: "sessionBrief", title: "Sessiebrief", body: promptSet["sessiebrief.md"], truncated: false },
      { id: "summaries", title: "Bloksamenvattingen", ...summary },
      { id: "transcript", title: "Recent letterlijk transcript", ...literal },
      { id: "notes", title: "Oogstnotities", ...noteSection },
    ];

    const sections = rendered.map(({ id, body, truncated }) => ({
      id,
      tokens: estimateTokens(body),
      budget: CONTEXT_BUDGETS[id],
      truncated,
    }));
    const warnings = sections
      .filter((section) => section.tokens > section.budget)
      .map((section) => `${section.id} gebruikt ${section.tokens}/${section.budget} geschatte tokens; niet afgekapt.`);
    const instructions = rendered.map(({ title, body }) => `# ${title}\n${body || "(geen)"}`).join("\n\n");

    return {
      instructions,
      totalTokens: estimateTokens(instructions),
      sections,
      warnings,
    };
  }
}

function fitLines(lines: string[], budget: number): { body: string; truncated: boolean } {
  const kept = [...lines];
  let body = kept.join("\n");
  let truncated = false;
  while (kept.length > 1 && estimateTokens(body) > budget) {
    kept.shift();
    truncated = true;
    body = kept.join("\n");
  }
  if (estimateTokens(body) > budget) {
    body = body.slice(-Math.floor(budget * 3.2));
    truncated = true;
  }
  return { body, truncated };
}

function renderNotes(notes: OogstNotitie[]): { body: string; truncated: boolean } {
  const render = (items: OogstNotitie[]) =>
    items.map((note) => `- ${note.text}${note.tags?.length ? ` [${note.tags.join(", ")}]` : ""}`).join("\n");
  const complete = render(notes);
  if (estimateTokens(complete) <= CONTEXT_BUDGETS.notes) return { body: complete, truncated: false };

  const tagCounts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const counts = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => `${tag}:${count}`)
    .join(", ");
  const header = `Totaal: ${notes.length}. Tags: ${counts || "geen"}. Laatste notities:`;
  const latest = notes.slice(-15);
  const fitted = fitLines(latest.map((note) => `- ${note.text}${note.tags?.length ? ` [${note.tags.join(", ")}]` : ""}`), Math.max(1, CONTEXT_BUDGETS.notes - estimateTokens(`${header}\n`)));
  return { body: `${header}\n${fitted.body}`, truncated: true };
}
