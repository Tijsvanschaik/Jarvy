import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateSyntheticRehearsalWav, runReplay } from "./replay";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("offline five-routine replay", () => {
  it("runs the full deterministic chain without unsolicited Realtime activation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiden-replay-test-"));
    roots.push(root);
    const file = path.join(root, "synthetic.wav");
    await fs.writeFile(file, new Uint8Array(generateSyntheticRehearsalWav()));
    const report = await runReplay({
      file,
      dataDir: path.join(root, "data"),
      repoRoot: process.cwd(),
      offlineFixtures: path.join(process.cwd(), "fixtures", "rehearsal.json"),
    });
    expect(report).toMatchObject({
      ok: true,
      mode: "offline",
      chunks: 5,
      transcripts: 5,
      unsolicitedActivations: 0,
      boardPins: 1,
      recap: { evidenceRejections: 1 },
    });
    expect(report.activations).toBeGreaterThan(0);
    expect(report.toolOrder.indexOf("zoek_signaal")).toBeLessThan(report.toolOrder.indexOf("toon_op_bord"));
    expect(report).not.toHaveProperty("transcriptExcerpts");
  });
});
