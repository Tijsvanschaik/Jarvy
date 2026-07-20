import path from "node:path";

export type RuntimePaths = {
  repoRoot: string;
  dataDir: string;
  promptDefaultsDir: string;
  runtimePromptsDir: string;
};

export function resolveRuntimePaths(repoRoot = process.cwd()): RuntimePaths {
  const root = path.resolve(repoRoot);
  const dataDir = path.join(root, "data");
  return {
    repoRoot: root,
    dataDir,
    promptDefaultsDir: path.join(root, "prompts"),
    runtimePromptsDir: path.join(dataDir, "prompts"),
  };
}
