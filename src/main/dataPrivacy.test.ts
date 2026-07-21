import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupSessions, exportSession } from "./dataPrivacy";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiden-privacy-"));
  roots.push(root);
  const data = path.join(root, "data");
  await fs.mkdir(path.join(data, "transcript"), { recursive: true });
  await fs.mkdir(path.join(data, "audio", "chunks"), { recursive: true });
  await fs.mkdir(path.join(data, "oogst"), { recursive: true });
  await fs.mkdir(path.join(data, "signalen"), { recursive: true });
  const entry = {
    id: "one",
    tsStart: Date.parse("2026-07-20T10:00:00Z"),
    tsEnd: Date.parse("2026-07-20T10:00:01Z"),
    text: "private fixture text",
    source: "room",
    block: "1",
    chunkFile: "audio/chunks/one.wav",
  };
  await fs.writeFile(path.join(data, "transcript", "2026-07-20.jsonl"), `${JSON.stringify(entry)}\n`);
  await fs.writeFile(path.join(data, "audio", "chunks", "one.wav"), "fake");
  await fs.writeFile(path.join(data, "oogst", "notities.jsonl"), `${JSON.stringify({
    id: "n1", type: "inzicht", tekst: "fixture", block: "1", timestamp: "2026-07-20T10:00:00.000Z",
  })}\n`);
  await fs.writeFile(path.join(data, "summaries.json"), JSON.stringify([{ id: "s", block: "1", summary: "x", createdAt: "2026-07-20T10:00:00.000Z", coversUntil: entry.tsEnd }]));
  await fs.writeFile(path.join(data, "signalen", "board-state.json"), JSON.stringify({ pins: [] }));
  await fs.mkdir(path.join(data, "prompts"), { recursive: true });
  await fs.writeFile(path.join(data, "prompts", "persona.md"), "do not delete");
  await fs.writeFile(path.join(data, "signalen", "bibliotheek.json"), "do not delete");
  return { root, data };
}

describe("session privacy tools", () => {
  it("exports selected metadata and excludes audio by default", async () => {
    const { root, data } = await setup();
    const output = path.join(root, "export");
    const result = await exportSession({ dataDir: data, outputDir: output, date: "2026-07-20" });
    expect(result.files).toContain("transcript.jsonl");
    await expect(fs.access(path.join(output, "audio"))).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(path.join(output, "manifest.json"), "utf8")).includesRawAudio).toBe(false);
  });

  it("is dry-run by default and confirmed cleanup stays in scope", async () => {
    const { data } = await setup();
    const dry = await cleanupSessions({ dataDir: data, selector: { date: "2026-07-20" } });
    expect(dry.dryRun).toBe(true);
    await expect(fs.access(path.join(data, "transcript", "2026-07-20.jsonl"))).resolves.toBeUndefined();
    await cleanupSessions({ dataDir: data, selector: { date: "2026-07-20" }, confirm: true });
    await expect(fs.access(path.join(data, "transcript", "2026-07-20.jsonl"))).rejects.toThrow();
    await expect(fs.readFile(path.join(data, "prompts", "persona.md"), "utf8")).resolves.toBe("do not delete");
    await expect(fs.readFile(path.join(data, "signalen", "bibliotheek.json"), "utf8")).resolves.toBe("do not delete");
  });
});
