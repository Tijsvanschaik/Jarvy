import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRuntimePaths } from "./paths";
import { PROMPT_FILES, PromptLoader } from "./promptLoader";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("PromptLoader", () => {
  it("bootstraps missing defaults without overwriting runtime edits and hot reloads", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-prompts-"));
    roots.push(root);
    const paths = resolveRuntimePaths(root);
    await fs.mkdir(paths.promptDefaultsDir, { recursive: true });
    await Promise.all(PROMPT_FILES.map((name) => fs.writeFile(path.join(paths.promptDefaultsDir, name), `default ${name}`)));

    const loader = new PromptLoader(paths);
    expect((await loader.loadFresh())["persona.md"]).toBe("default persona.md");

    await fs.writeFile(path.join(paths.runtimePromptsDir, "persona.md"), "runtime edit");
    expect((await loader.loadFresh())["persona.md"]).toBe("runtime edit");
    expect(await fs.readFile(path.join(paths.runtimePromptsDir, "persona.md"), "utf8")).toBe("runtime edit");
  });
});
