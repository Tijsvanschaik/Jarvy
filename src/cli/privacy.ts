import path from "node:path";
import { cleanupSessions, exportSession } from "../main/dataPrivacy";
import { resolveRuntimePaths } from "../main/paths";

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);
  const dataDir = resolveRuntimePaths(process.cwd()).dataDir;
  if (command === "export") {
    if (!args.date || !args.output) throw new Error("Usage: npm run session:export -- --date YYYY-MM-DD --output <folder> [--include-audio]");
    const result = await exportSession({
      dataDir,
      date: args.date,
      outputDir: args.output,
      includeAudio: args.includeAudio,
    });
    console.log(`Exported ${result.files.length} files to ${result.outputDir}. Raw audio: ${args.includeAudio ? "included" : "excluded"}.`);
    return;
  }
  if (command === "cleanup") {
    const result = await cleanupSessions({
      dataDir,
      selector: { date: args.date, olderThanDays: args.olderThan },
      confirm: args.confirm,
    });
    console.log(`${result.dryRun ? "DRY RUN" : "CLEANED"}: ${result.affected.length} scoped runtime path(s).`);
    for (const item of result.affected) console.log(`- ${item}`);
    console.log(`Protected: ${result.retained.join(", ")}`);
    if (result.dryRun) console.log("Re-run with --confirm to apply exactly this cleanup scope.");
    return;
  }
  throw new Error("Use session export or cleanup.");
}

function parseArgs(argv: string[]) {
  const result: { date?: string; output?: string; includeAudio?: boolean; olderThan?: number; confirm?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]!;
    if (key === "--include-audio") result.includeAudio = true;
    else if (key === "--confirm") result.confirm = true;
    else {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${key}.`);
      if (key === "--date") result.date = value;
      else if (key === "--output") result.output = path.resolve(value);
      else if (key === "--older-than") result.olderThan = Number(value);
      else throw new Error(`Unknown argument ${key}.`);
    }
  }
  return result;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
