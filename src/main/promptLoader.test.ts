import fs from "node:fs/promises";
import crypto from "node:crypto";
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
  async function setup() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiden-prompts-"));
    roots.push(root);
    const paths = resolveRuntimePaths(root);
    await fs.mkdir(paths.promptDefaultsDir, { recursive: true });
    await Promise.all(PROMPT_FILES.map((name) => fs.writeFile(path.join(paths.promptDefaultsDir, name), `default ${name}`)));
    await fs.writeFile(
      path.join(paths.promptDefaultsDir, "manifest.json"),
      JSON.stringify({
        version: 2,
        templates: Object.fromEntries(PROMPT_FILES.map((name) => [
          name,
          { sha256: hash(`default ${name}`), previousSha256: [hash(`old ${name}`)] },
        ])),
      }),
    );
    return { root, paths };
  }

  it("bootstraps every missing template", async () => {
    const { paths } = await setup();
    const result = await new PromptLoader(paths).bootstrap();
    expect(result.created).toEqual(PROMPT_FILES);
    expect((await fs.readFile(path.join(paths.runtimePromptsDir, "persona.md"), "utf8"))).toBe("default persona.md");
  });

  it("upgrades untouched prior defaults and creates a backup", async () => {
    const { paths } = await setup();
    await fs.mkdir(paths.runtimePromptsDir, { recursive: true });
    await Promise.all(PROMPT_FILES.map((name) => fs.writeFile(path.join(paths.runtimePromptsDir, name), `old ${name}`)));
    const result = await new PromptLoader(paths).bootstrap();
    expect(result.upgraded).toEqual(PROMPT_FILES);
    expect((await fs.readdir(path.join(paths.runtimePromptsDir, "backups"))).length).toBe(4);
  });

  it("retains edited templates and emits an actionable warning", async () => {
    const { paths } = await setup();
    const warnings: string[] = [];
    const loader = new PromptLoader(paths, (warning) => warnings.push(warning));
    await loader.bootstrap();
    await fs.writeFile(path.join(paths.runtimePromptsDir, "persona.md"), "runtime edit");
    const result = await loader.bootstrap();
    expect(result.status.find((item) => item.name === "persona.md")?.state).toBe("update-available");
    expect(warnings.at(-1)).toContain("npm run prompts -- review persona.md");
    expect((await loader.loadFresh())["persona.md"]).toBe("runtime edit");
  });

  it("backs up and resets an edited template explicitly", async () => {
    const { paths } = await setup();
    const loader = new PromptLoader(paths);
    await loader.bootstrap();
    await fs.writeFile(path.join(paths.runtimePromptsDir, "persona.md"), "local");
    await loader.apply("persona.md");
    expect(await fs.readFile(path.join(paths.runtimePromptsDir, "persona.md"), "utf8")).toBe("default persona.md");
    const backups = await fs.readdir(path.join(paths.runtimePromptsDir, "backups"));
    expect(backups.some((name) => name.startsWith("persona.md."))).toBe(true);
  });
});

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
