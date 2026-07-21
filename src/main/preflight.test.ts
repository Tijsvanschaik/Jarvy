import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PromptLoader } from "./promptLoader";
import { runPreflight } from "./preflight";
import { SignalStore } from "./signalStore";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("preflight", () => {
  it("is secret-free, offline-safe, and never requests devices", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiden-preflight-"));
    roots.push(root);
    const paths = {
      repoRoot: process.cwd(),
      dataDir: path.join(root, "data"),
      promptDefaultsDir: path.join(process.cwd(), "prompts"),
      runtimePromptsDir: path.join(root, "data", "prompts"),
    };
    const prompts = new PromptLoader(paths);
    const signals = SignalStore.inDataDir(paths.dataDir, process.cwd());
    await Promise.all([prompts.bootstrap(), signals.bootstrap()]);
    const report = await runPreflight({
      dataDir: paths.dataDir,
      prompts,
      signals,
      env: { OPENAI_API_KEY: "super-secret" },
      network: false,
      minimumFreeBytes: 1,
    });
    expect(report.ok).toBe(true);
    expect(JSON.stringify(report)).not.toContain("super-secret");
    expect(report.checks.find((check) => check.id === "devices")?.status).toBe("skipped");
    expect(report.checks.find((check) => check.id === "openai-network")?.status).toBe("skipped");
  });
});
