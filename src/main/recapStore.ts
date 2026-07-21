import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { recapDeckSchema } from "../shared/schemas";
import type { BlockSummary, OogstNotitie, RecapDeck, TranscriptEntry } from "../shared/types";
import { atomicWriteJson, readJsonFile } from "./persistence";

export const RECAP_CACHE_VERSION = 1;

const recapCacheSchema = z
  .object({
    version: z.literal(RECAP_CACHE_VERSION),
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
    deck: recapDeckSchema,
  })
  .strict();

export type RecapCache = z.infer<typeof recapCacheSchema>;

export class RecapStore {
  readonly deckPath: string;
  readonly imagesDir: string;
  private cached: RecapCache | undefined;

  constructor(
    recapDir: string,
    private readonly warn: (message: string) => void = () => undefined,
  ) {
    this.deckPath = path.join(recapDir, "deck.json");
    this.imagesDir = path.join(recapDir, "images");
  }

  static inDataDir(dataDir: string, warn?: (message: string) => void): RecapStore {
    return new RecapStore(path.join(dataDir, "recap"), warn);
  }

  async load(): Promise<RecapCache | undefined> {
    try {
      const value = await readJsonFile(this.deckPath);
      if (value === undefined) return undefined;
      const parsed = recapCacheSchema.safeParse(value);
      if (!parsed.success) {
        this.warn("Recapcache is ongeldig; Aiden maakt deze bij de volgende recap opnieuw.");
        this.cached = undefined;
        return undefined;
      }
      this.cached = parsed.data;
      return parsed.data;
    } catch {
      this.warn("Recapcache kon niet worden gelezen; Aiden maakt deze bij de volgende recap opnieuw.");
      this.cached = undefined;
      return undefined;
    }
  }

  snapshot(): RecapCache | undefined {
    return this.cached ? { ...this.cached, deck: structuredClone(this.cached.deck) } : undefined;
  }

  async save(cacheKey: string, deck: RecapDeck): Promise<void> {
    const cache = recapCacheSchema.parse({ version: RECAP_CACHE_VERSION, cacheKey, deck });
    await atomicWriteJson(this.deckPath, cache);
    this.cached = cache;
  }
}

export function recapCacheKey(input: {
  transcript: TranscriptEntry[];
  summaries: BlockSummary[];
  notes: OogstNotitie[];
}): string {
  const normalized = {
    version: RECAP_CACHE_VERSION,
    transcript: [...input.transcript].sort(byId),
    summaries: [...input.summaries].sort(byId),
    notes: [...input.notes].sort(byId),
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
