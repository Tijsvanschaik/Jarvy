import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SignalStore } from "./signalStore";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

const sample = {
  id: "demo-een", titel: "Demo", laag: 1, domein: "algemeen", type: "zacht",
  kernfeit: "Geen claim", bron: "sample", jaar: "demo", beleidsvraag: "Wat testen we?", uitlegKort: "Uitleg",
};

describe("SignalStore", () => {
  it("bootstraps, validates and indexes defaults", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-signals-"));
    roots.push(root);
    const defaults = path.join(root, "default.json");
    const runtime = path.join(root, "data", "bibliotheek.json");
    await fs.writeFile(defaults, JSON.stringify([sample]));
    const store = new SignalStore(runtime, defaults);
    await store.bootstrap();
    expect((await store.find("demo-een"))?.titel).toBe("Demo");
    expect(JSON.parse(await fs.readFile(runtime, "utf8"))).toHaveLength(1);
  });

  it("reports duplicate ids and rejects malformed cards", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-signals-"));
    roots.push(root);
    const file = path.join(root, "library.json");
    await fs.writeFile(file, JSON.stringify([sample, { ...sample, titel: "Duplicate" }]));
    const warnings: string[] = [];
    const store = new SignalStore(file, file, warnings.push.bind(warnings));
    await store.reload();
    expect(store.list()).toHaveLength(1);
    expect(warnings[0]).toContain("Duplicate signal id");
    await fs.writeFile(file, JSON.stringify([{ ...sample, id: "Not a slug" }]));
    await expect(store.reload()).rejects.toThrow();
  });
});
