import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { recapCacheKey, RecapStore } from "./recapStore";

describe("RecapStore", () => {
  it("loads valid cache after restart and recovers from corrupt cache", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aiden-recap-store-"));
    try {
      const first = new RecapStore(directory);
      const cacheKey = "a".repeat(64);
      await first.save(cacheKey, {
        id: "deck",
        createdAt: "2026-08-27T12:00:00.000Z",
        slides: [{ id: "slot", soort: "slot", titel: "Slot", bullets: ["Klaar"] }],
      });
      const second = new RecapStore(directory);
      await expect(second.load()).resolves.toMatchObject({ cacheKey });

      await fs.writeFile(second.deckPath, "{broken", "utf8");
      const warning = vi.fn();
      const corrupt = new RecapStore(directory, warning);
      await expect(corrupt.load()).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("keys transcript, summaries, notes, and cache version deterministically", () => {
    const base = { transcript: [], summaries: [], notes: [] };
    expect(recapCacheKey(base)).toBe(recapCacheKey(base));
    expect(
      recapCacheKey({
        ...base,
        transcript: [{ id: "t", tsStart: 1, tsEnd: 2, text: "nieuw", source: "room", block: "b" }],
      }),
    ).not.toBe(recapCacheKey(base));
    expect(
      recapCacheKey({
        ...base,
        summaries: [{ id: "s", block: "b", summary: "samenvatting", createdAt: "nu", coversUntil: 2 }],
      }),
    ).not.toBe(recapCacheKey(base));
    expect(
      recapCacheKey({
        ...base,
        notes: [{
          id: "n",
          block: "b",
          tekst: "oogst",
          type: "inzicht",
          timestamp: "2026-08-27T12:00:00.000Z",
        }],
      }),
    ).not.toBe(recapCacheKey(base));
  });
});
