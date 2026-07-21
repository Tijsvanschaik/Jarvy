import fs from "node:fs/promises";
import path from "node:path";
import type { PromptLoader } from "./promptLoader";
import type { SignalStore } from "./signalStore";

export type PreflightCheck = {
  id: string;
  status: "pass" | "warn" | "fail" | "skipped";
  message: string;
  latencyMs?: number;
};

export type PreflightReport = {
  ok: boolean;
  checkedAt: string;
  checks: PreflightCheck[];
};

export type PreflightOptions = {
  dataDir: string;
  prompts: PromptLoader;
  signals: SignalStore;
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  minimumFreeBytes?: number;
  network?: boolean;
};

export async function runPreflight(options: PreflightOptions): Promise<PreflightReport> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const checks: PreflightCheck[] = [];
  const key = env.OPENAI_API_KEY;
  checks.push({
    id: "openai-key",
    status: key ? "pass" : "warn",
    message: key ? "OPENAI_API_KEY is configured (value hidden)." : "OPENAI_API_KEY is absent; live activation/transcription is unavailable.",
  });

  if (options.network === false) {
    checks.push({ id: "openai-network", status: "skipped", message: "Network check disabled." });
  } else if (!key) {
    checks.push({ id: "openai-network", status: "skipped", message: "OpenAI reachability skipped because no key is configured." });
  } else {
    checks.push(await endpointCheck("openai-network", "https://api.openai.com/v1/models", fetcher, {
      Authorization: `Bearer ${key}`,
    }));
  }

  if (!env.EXA_API_KEY) {
    checks.push({ id: "exa", status: "skipped", message: "EXA_API_KEY is absent; web fallback is optional." });
  } else if (options.network === false) {
    checks.push({ id: "exa", status: "skipped", message: "Exa network check disabled." });
  } else {
    checks.push(await endpointCheck("exa", "https://api.exa.ai", fetcher, { "x-api-key": env.EXA_API_KEY }));
  }

  try {
    await fs.mkdir(options.dataDir, { recursive: true });
    const probe = path.join(options.dataDir, `.preflight-${process.pid}-${Date.now()}`);
    await fs.writeFile(probe, "");
    await fs.rm(probe);
    checks.push({ id: "data-writable", status: "pass", message: "Runtime data folder is writable." });
  } catch (error) {
    checks.push({ id: "data-writable", status: "fail", message: `Runtime data folder is not writable: ${message(error)}` });
  }

  try {
    const stats = await fs.statfs(options.dataDir);
    const free = Number(stats.bavail) * Number(stats.bsize);
    const threshold = options.minimumFreeBytes ?? 512 * 1024 * 1024;
    checks.push({
      id: "disk-space",
      status: free >= threshold ? "pass" : "fail",
      message:
        free >= threshold
          ? `${Math.floor(free / 1024 / 1024)} MiB free disk space.`
          : `Only ${Math.floor(free / 1024 / 1024)} MiB free; at least ${Math.floor(threshold / 1024 / 1024)} MiB is required.`,
    });
  } catch (error) {
    checks.push({ id: "disk-space", status: "warn", message: `Could not determine free disk space: ${message(error)}` });
  }

  try {
    const statuses = await options.prompts.status();
    const updates = statuses.filter((item) => item.state === "update-available");
    checks.push({
      id: "prompts",
      status: updates.length ? "warn" : "pass",
      message: updates.length
        ? `Local prompt edits retained; shipped updates available for: ${updates.map((item) => item.name).join(", ")}.`
        : "Prompt templates are current.",
    });
  } catch (error) {
    checks.push({ id: "prompts", status: "fail", message: `Prompt validation failed: ${message(error)}` });
  }

  try {
    await options.signals.reload();
    checks.push({ id: "signals", status: "pass", message: `${options.signals.list().length} signal library entries validated.` });
  } catch {
    checks.push({ id: "signals", status: "fail", message: "Signal library is invalid; review the operator warning." });
  }

  checks.push({
    id: "devices",
    status: "skipped",
    message: "Microphone/camera checks require an explicit renderer request; preflight never opens devices.",
  });
  return {
    ok: checks.every((check) => check.status !== "fail"),
    checkedAt: new Date().toISOString(),
    checks,
  };
}

async function endpointCheck(
  id: string,
  url: string,
  fetcher: typeof fetch,
  headers: Record<string, string>,
): Promise<PreflightCheck> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetcher(url, { method: "GET", headers, signal: controller.signal });
    const latencyMs = Math.round(performance.now() - started);
    if (response.ok) return { id, status: "pass", message: "Endpoint reachable; no generation was requested.", latencyMs };
    if (response.status === 401 || response.status === 403) {
      return { id, status: "fail", message: `Authentication rejected (${response.status}); verify the configured key.`, latencyMs };
    }
    if (response.status === 429) {
      return { id, status: "fail", message: "Quota/rate limit response (429); review provider billing and limits.", latencyMs };
    }
    if (response.status >= 500) {
      return { id, status: "warn", message: `Provider service error (${response.status}); retry before the session.`, latencyMs };
    }
    return { id, status: "warn", message: `Endpoint returned HTTP ${response.status}; verify endpoint/model configuration.`, latencyMs };
  } catch (error) {
    return {
      id,
      status: "fail",
      message: (error as Error).name === "AbortError" ? "Network check timed out after 5 seconds." : `Network failure: ${message(error)}`,
      latencyMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
