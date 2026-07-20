import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "./paths";

export const PROMPT_FILES = ["persona.md", "gedragsregels.md", "demo-modi.md", "sessiebrief.md"] as const;
export type PromptName = (typeof PROMPT_FILES)[number];
export type PromptSet = Record<PromptName, string>;

export class PromptLoader {
  constructor(private readonly paths: RuntimePaths) {}

  async bootstrap(): Promise<void> {
    await fs.mkdir(this.paths.runtimePromptsDir, { recursive: true });
    await Promise.all(
      PROMPT_FILES.map(async (name) => {
        const target = path.join(this.paths.runtimePromptsDir, name);
        try {
          await fs.access(target);
        } catch {
          await fs.copyFile(path.join(this.paths.promptDefaultsDir, name), target);
        }
      }),
    );
  }

  async loadFresh(): Promise<PromptSet> {
    await this.bootstrap();
    const entries = await Promise.all(
      PROMPT_FILES.map(async (name) => [
        name,
        (await fs.readFile(path.join(this.paths.runtimePromptsDir, name), "utf8")).trim(),
      ] as const),
    );
    return Object.fromEntries(entries) as PromptSet;
  }
}
