import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigStore } from "./configStore";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("ConfigStore", () => {
  it("defaults to 1-welkom and persists block switches", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-config-"));
    roots.push(root);
    const store = ConfigStore.inDataDir(root);
    await store.load();
    expect(store.currentBlock).toBe("1-welkom");
    await store.setBlock("2-verdieping");
    const recovered = ConfigStore.inDataDir(root);
    await recovered.load();
    expect(recovered.currentBlock).toBe("2-verdieping");
  });
});
