import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { BlockSummary, TranscriptEntry } from "../shared/types";
import { atomicWriteJson, quarantineFile, readJsonFileRecovering } from "./persistence";
import type { TranscriptStore } from "./transcriptStore";

const blockSummarySchema: z.ZodType<BlockSummary> = z.object({
  id: z.string().min(1),
  block: z.string().min(1),
  summary: z.string().min(1),
  createdAt: z.string().min(1),
  coversUntil: z.number().finite().nonnegative(),
});
const summaryFileSchema = z.array(blockSummarySchema);

export type SummaryRequest = {
  block: string;
  entries: TranscriptEntry[];
  previous?: BlockSummary;
  prompt: string;
};

export type SummaryProvider = {
  summarize: (request: SummaryRequest) => Promise<string>;
};

export class OpenAISummaryProvider implements SummaryProvider {
  constructor(
    private readonly apiKey: () => string | undefined,
    private readonly model = "gpt-4.1-mini",
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  async summarize(request: SummaryRequest): Promise<string> {
    const key = this.apiKey();
    if (!key) throw new Error("OPENAI_API_KEY is missing for summary scheduling.");
    const transcript = request.entries.map((entry) => entry.text).join("\n");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          max_output_tokens: 220,
          input: [
            request.prompt,
            request.previous ? `Bestaande samenvatting:\n${request.previous.summary}` : "",
            `Nieuwe transcriptregels voor ${request.block}:\n${transcript}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        }),
      });
    } catch (error) {
      throw new Error((error as Error).name === "AbortError" ? "Summary request timed out." : "Summary network request failed.");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`Summary request failed (${providerGuidance(response.status)}).`);
    const value = (await response.json()) as {
      output_text?: unknown;
      output?: Array<{ content?: Array<{ text?: unknown }> }>;
    };
    const text =
      typeof value.output_text === "string"
        ? value.output_text
        : value.output?.flatMap((item) => item.content ?? []).find((part) => typeof part.text === "string")?.text;
    if (typeof text !== "string" || !text.trim()) throw new Error("Summary response did not contain text.");
    return text;
  }
}

function providerGuidance(status: number): string {
  if (status === 401 || status === 403) return `auth ${status}; verify API key`;
  if (status === 429) return "quota/rate limit 429; review billing";
  if (status >= 500) return `provider/network ${status}; retry`;
  return `HTTP ${status}; verify model/configuration`;
}

export class SummaryStore {
  private summaries: BlockSummary[] = [];

  constructor(
    private readonly filePath: string,
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  static inDataDir(dataDir: string, warn?: (message: string) => void): SummaryStore {
    return new SummaryStore(path.join(dataDir, "summaries.json"), warn);
  }

  async load(): Promise<void> {
    const raw = await readJsonFileRecovering(this.filePath, this.warn);
    const parsed = summaryFileSchema.safeParse(raw ?? []);
    if (!parsed.success) {
      this.warn("Summary state was invalid; it was quarantined and skipped.");
      await quarantineFile(this.filePath, this.warn);
    }
    this.summaries = parsed.success ? parsed.data : [];
  }

  async list(): Promise<BlockSummary[]> {
    return [...this.summaries].sort((left, right) => left.coversUntil - right.coversUntil);
  }

  async put(summary: BlockSummary): Promise<void> {
    const parsed = blockSummarySchema.parse(summary);
    const next = this.summaries.filter((item) => item.block !== parsed.block);
    next.push(parsed);
    await atomicWriteJson(this.filePath, next);
    this.summaries = next;
  }
}

export class SummaryScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | null = null;

  constructor(
    private readonly transcript: TranscriptStore,
    private readonly summaries: SummaryStore,
    private readonly provider: SummaryProvider,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.run(), 10 * 60_000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  notifyBlockChange(): Promise<void> {
    return this.run();
  }

  run(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.execute().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async execute(): Promise<void> {
    const cutoff = this.now() - 15 * 60_000;
    const [entries, summaries] = await Promise.all([this.transcript.list(), this.summaries.list()]);
    const previousByBlock = new Map(summaries.map((summary) => [summary.block, summary]));
    const groups = new Map<string, TranscriptEntry[]>();
    for (const entry of entries) {
      if (entry.source !== "room" || !entry.block || entry.tsEnd > cutoff) continue;
      const covered = previousByBlock.get(entry.block)?.coversUntil ?? -1;
      if (entry.tsEnd <= covered) continue;
      const group = groups.get(entry.block) ?? [];
      group.push(entry);
      groups.set(entry.block, group);
    }

    for (const [block, uncovered] of groups) {
      const previous = previousByBlock.get(block);
      const text = (await this.provider.summarize({
        block,
        entries: uncovered,
        previous,
        prompt:
          "Vat het blok feitelijk en beknopt samen in het Nederlands (~150 tokens). Behoud namen exact, voeg geen interpretatie toe.",
      })).trim();
      if (!text) continue;
      await this.summaries.put({
        id: previous?.id ?? crypto.randomUUID(),
        block,
        summary: text,
        createdAt: new Date(this.now()).toISOString(),
        coversUntil: Math.max(...uncovered.map((entry) => entry.tsEnd)),
      });
    }
  }
}
