import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TranscriptStore } from "./transcriptStore";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("TranscriptStore", () => {
  it("loads valid JSONL around corrupt lines and appends durably", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-transcript-"));
    temporaryDirectories.push(root);
    const directory = path.join(root, "transcript");
    await fs.mkdir(directory);
    const valid = { id: "a", tsStart: 1, tsEnd: 2, text: "Hallo", source: "room" };
    await fs.writeFile(path.join(directory, "1970-01-01.jsonl"), `${JSON.stringify(valid)}\nnot-json\n`);
    const warnings: string[] = [];
    const store = new TranscriptStore(directory, (warning) => warnings.push(warning));
    await store.load();
    await store.append({ id: "b", tsStart: 3, tsEnd: 4, text: "Ricky", source: "assistant" });
    expect((await store.list()).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(warnings).toEqual([expect.stringContaining(":2")]);

    const recovered = new TranscriptStore(directory);
    await recovered.load();
    expect((await recovered.list()).map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});
