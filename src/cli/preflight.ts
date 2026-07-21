import path from "node:path";
import fs from "node:fs/promises";
import { resolveRuntimePaths } from "../main/paths";
import { PromptLoader } from "../main/promptLoader";
import { runPreflight } from "../main/preflight";
import { SignalStore } from "../main/signalStore";

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const root = process.cwd();
  await loadLocalEnv(path.join(root, ".env.local"));
  const paths = resolveRuntimePaths(root);
  const warnings: string[] = [];
  const prompts = new PromptLoader(paths, (warning) => warnings.push(warning));
  const signals = SignalStore.inDataDir(paths.dataDir, root, (warning) => warnings.push(warning));
  await Promise.all([prompts.bootstrap(), signals.bootstrap()]);
  const report = await runPreflight({
    dataDir: paths.dataDir,
    prompts,
    signals,
    network: !offline,
    minimumFreeBytes: Number(process.env.AIDEN_MIN_FREE_DISK_MB || 512) * 1024 * 1024,
  });
  for (const check of report.checks) {
    console.log(`${check.status.toUpperCase().padEnd(7)} ${check.id}: ${check.message}${check.latencyMs === undefined ? "" : ` (${check.latencyMs} ms)`}`);
  }
  console.log(`AIDEN_PREFLIGHT_REPORT=${JSON.stringify(report)}`);
  if (!report.ok) process.exitCode = 1;
}

async function loadLocalEnv(filePath: string): Promise<void> {
  const content = await fs.readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || process.env[match[1]!] !== undefined) continue;
    const raw = match[2]!;
    process.env[match[1]!] = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw.replace(/\s+#.*$/, "");
  }
}

void main().catch((error) => {
  console.error(`Preflight failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
