import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { RuntimePaths } from "./paths";

export const PROMPT_FILES = ["persona.md", "gedragsregels.md", "demo-modi.md", "sessiebrief.md"] as const;
export type PromptName = (typeof PROMPT_FILES)[number];
export type PromptSet = Record<PromptName, string>;

const manifestSchema = z.object({
  version: z.number().int().positive(),
  templates: z.record(
    z.enum(PROMPT_FILES),
    z.object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      previousSha256: z.array(z.string().regex(/^[a-f0-9]{64}$/)).default([]),
    }),
  ),
});

export type PromptStatus = {
  name: PromptName;
  state: "current" | "update-available" | "missing";
  runtimeSha256?: string;
  shippedSha256: string;
};

export type PromptBootstrapResult = {
  created: PromptName[];
  upgraded: PromptName[];
  warnings: string[];
  status: PromptStatus[];
};

export class PromptLoader {
  constructor(
    private readonly paths: RuntimePaths,
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  async bootstrap(): Promise<PromptBootstrapResult> {
    await fs.mkdir(this.paths.runtimePromptsDir, { recursive: true });
    const manifest = await this.readManifest();
    const created: PromptName[] = [];
    const upgraded: PromptName[] = [];
    const warnings: string[] = [];
    const status: PromptStatus[] = [];
    for (const name of PROMPT_FILES) {
      const target = path.join(this.paths.runtimePromptsDir, name);
      const shipped = await fs.readFile(path.join(this.paths.promptDefaultsDir, name));
      const shippedSha256 = hash(shipped);
      const declared = manifest.templates[name];
      if (declared.sha256 !== shippedSha256) {
        throw new Error(`Prompt manifest hash mismatch for ${name}; run npm run prompts -- check.`);
      }
      const runtime = await fs.readFile(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!runtime) {
        await fs.writeFile(target, shipped);
        created.push(name);
        status.push({ name, state: "current", runtimeSha256: shippedSha256, shippedSha256 });
        continue;
      }
      const runtimeSha256 = hash(runtime);
      if (runtimeSha256 === shippedSha256) {
        status.push({ name, state: "current", runtimeSha256, shippedSha256 });
      } else if (declared.previousSha256.includes(runtimeSha256)) {
        await this.backup(name, runtime);
        await fs.writeFile(target, shipped);
        upgraded.push(name);
        status.push({ name, state: "current", runtimeSha256: shippedSha256, shippedSha256 });
      } else {
        const warning = `Prompt template update available for ${name}; local edit retained. Run 'npm run prompts -- review ${name}'.`;
        warnings.push(warning);
        this.warn(warning);
        status.push({ name, state: "update-available", runtimeSha256, shippedSha256 });
      }
    }
    return { created, upgraded, warnings, status };
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

  async status(): Promise<PromptStatus[]> {
    return (await this.bootstrap()).status;
  }

  async apply(name: PromptName): Promise<string> {
    this.assertName(name);
    const target = path.join(this.paths.runtimePromptsDir, name);
    const runtime = await fs.readFile(target).catch(() => undefined);
    if (runtime) await this.backup(name, runtime);
    await fs.copyFile(path.join(this.paths.promptDefaultsDir, name), target);
    return target;
  }

  async review(name: PromptName): Promise<{ runtime: string; shipped: string; status: PromptStatus }> {
    this.assertName(name);
    await fs.mkdir(this.paths.runtimePromptsDir, { recursive: true });
    const [runtime, shipped, status] = await Promise.all([
      fs.readFile(path.join(this.paths.runtimePromptsDir, name), "utf8").catch(() => ""),
      fs.readFile(path.join(this.paths.promptDefaultsDir, name), "utf8"),
      this.status(),
    ]);
    return { runtime, shipped, status: status.find((item) => item.name === name)! };
  }

  private async backup(name: PromptName, contents: Buffer): Promise<string> {
    const backupDir = path.join(this.paths.runtimePromptsDir, "backups");
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `${name}.${stamp}.bak`);
    await fs.writeFile(backupPath, contents, { flag: "wx" });
    return backupPath;
  }

  private async readManifest() {
    return manifestSchema.parse(
      JSON.parse(await fs.readFile(path.join(this.paths.promptDefaultsDir, "manifest.json"), "utf8")),
    );
  }

  private assertName(name: string): asserts name is PromptName {
    if (!(PROMPT_FILES as readonly string[]).includes(name)) throw new Error(`Unknown prompt template '${name}'.`);
  }
}

function hash(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
