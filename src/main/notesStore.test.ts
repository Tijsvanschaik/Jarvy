import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigStore } from "./configStore";
import { NotesStore } from "./notesStore";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("NotesStore", () => {
  it("recovers valid JSONL, warns on corruption, counts and appends with current block", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-notes-"));
    roots.push(root);
    const config = ConfigStore.inDataDir(root);
    await config.load();
    await config.setBlock("2-verdieping");
    const file = path.join(root, "oogst", "notities.jsonl");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({
      id: "old", type: "vraag", tekst: "Bestaand?", block: "1-welkom", timestamp: new Date().toISOString(),
    })}\nnot-json\n`);
    const warnings: string[] = [];
    const store = NotesStore.inDataDir(root, config, warnings.push.bind(warnings));
    await store.load();
    const saved = await store.append({ deelnemer: "Ada", type: "inzicht", tekst: "Een nieuw inzicht" });

    expect(warnings).toEqual(["Skipped corrupt note line notities.jsonl:2."]);
    expect(saved.block).toBe("2-verdieping");
    expect(store.count).toBe(2);
    const recovered = NotesStore.inDataDir(root, config);
    await recovered.load();
    expect(await recovered.list()).toHaveLength(2);
  });
});
