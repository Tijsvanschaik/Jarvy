import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { TranscriptEntry } from "../shared/types";

export const transcriptEntrySchema: z.ZodType<TranscriptEntry> = z.object({
  id: z.string().min(1),
  tsStart: z.number().finite().nonnegative(),
  tsEnd: z.number().finite().nonnegative(),
  text: z.string().trim().min(1),
  source: z.enum(["room", "assistant"]),
  block: z.string().min(1).optional(),
  chunkFile: z.string().min(1).optional(),
});

export class TranscriptStore {
  private entries: TranscriptEntry[] = [];
  private appendQueue = Promise.resolve();

  constructor(
    private readonly directory: string,
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  async load(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const files = (await fs.readdir(this.directory)).filter((file) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort();
    const loaded: TranscriptEntry[] = [];
    for (const file of files) {
      const lines = (await fs.readFile(path.join(this.directory, file), "utf8")).split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        try {
          loaded.push(transcriptEntrySchema.parse(JSON.parse(line)));
        } catch {
          this.warn(`Skipped corrupt transcript line ${file}:${index + 1}.`);
        }
      }
    }
    this.entries = loaded.sort(compareEntries);
  }

  async append(input: TranscriptEntry): Promise<TranscriptEntry> {
    const entry = transcriptEntrySchema.refine((value) => value.tsEnd >= value.tsStart).parse(input);
    const operation = this.appendQueue.then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const filePath = path.join(this.directory, `${new Date(entry.tsStart).toISOString().slice(0, 10)}.jsonl`);
      const handle = await fs.open(filePath, "a");
      try {
        await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.entries.push(entry);
      this.entries.sort(compareEntries);
      return entry;
    });
    this.appendQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async recent(limit = 200): Promise<TranscriptEntry[]> {
    return this.entries.slice(-limit);
  }

  async list(): Promise<TranscriptEntry[]> {
    return [...this.entries];
  }
}

function compareEntries(left: TranscriptEntry, right: TranscriptEntry): number {
  return left.tsStart - right.tsStart || left.tsEnd - right.tsEnd || left.id.localeCompare(right.id);
}
