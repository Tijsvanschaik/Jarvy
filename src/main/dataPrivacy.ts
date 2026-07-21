import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { boardStateSchema, oogstNotitieSchema } from "../shared/schemas";
import { transcriptEntrySchema } from "./transcriptStore";
import { atomicWriteJson } from "./persistence";

export type SessionSelector = { date?: string; olderThanDays?: number; now?: number };
export type CleanupReport = { dryRun: boolean; affected: string[]; retained: string[] };

export async function exportSession(options: {
  dataDir: string;
  outputDir: string;
  date: string;
  includeAudio?: boolean;
}): Promise<{ outputDir: string; files: string[] }> {
  assertDate(options.date);
  const output = path.resolve(options.outputDir);
  const data = path.resolve(options.dataDir);
  if (isInside(output, data)) throw new Error("Export output must be outside the runtime data directory.");
  await fs.mkdir(output, { recursive: true });
  const written: string[] = [];
  const transcriptPath = path.join(data, "transcript", `${options.date}.jsonl`);
  const entries = await readJsonLines(transcriptPath, transcriptEntrySchema);
  await writeJsonLines(path.join(output, "transcript.jsonl"), entries);
  written.push("transcript.jsonl");

  const summaries = z.array(z.object({ createdAt: z.string() }).passthrough()).parse(
    await readJson(path.join(data, "summaries.json"), []),
  ).filter((item) => item.createdAt.startsWith(options.date));
  await atomicWriteJson(path.join(output, "summaries.json"), summaries);
  written.push("summaries.json");

  const notes = (await readJsonLines(path.join(data, "oogst", "notities.jsonl"), oogstNotitieSchema))
    .filter((note) => note.timestamp.startsWith(options.date));
  await writeJsonLines(path.join(output, "notes.jsonl"), notes);
  written.push("notes.jsonl");

  const board = boardStateSchema.parse(await readJson(path.join(data, "signalen", "board-state.json"), { pins: [] }));
  await atomicWriteJson(path.join(output, "board.json"), {
    pins: board.pins.filter((pin) => pin.pinnedAt.startsWith(options.date)),
  });
  written.push("board.json");

  const recap = await readJson(path.join(data, "recap", "deck.json"), undefined);
  if (recap && JSON.stringify(recap).includes(options.date)) {
    await atomicWriteJson(path.join(output, "recap.json"), recap);
    written.push("recap.json");
  }

  if (options.includeAudio) {
    const audioDir = path.join(output, "audio");
    for (const entry of entries) {
      if (!entry.chunkFile) continue;
      const source = safeDataPath(data, entry.chunkFile);
      const destination = path.join(audioDir, path.basename(entry.chunkFile));
      try {
        await fs.mkdir(audioDir, { recursive: true });
        await fs.copyFile(source, destination);
        written.push(path.relative(output, destination));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  await atomicWriteJson(path.join(output, "manifest.json"), {
    product: "Aiden",
    date: options.date,
    includesRawAudio: Boolean(options.includeAudio),
    files: written,
    exportedAt: new Date().toISOString(),
  });
  written.push("manifest.json");
  return { outputDir: output, files: written };
}

export async function cleanupSessions(options: {
  dataDir: string;
  selector: SessionSelector;
  confirm?: boolean;
}): Promise<CleanupReport> {
  const data = path.resolve(options.dataDir);
  const matches = selector(options.selector);
  const affected: string[] = [];
  const retained: string[] = [];
  const transcriptDir = path.join(data, "transcript");
  const audio = new Set<string>();
  for (const file of await fs.readdir(transcriptDir).catch(() => [])) {
    const date = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(file)?.[1];
    if (!date || !matches(date)) continue;
    const filePath = path.join(transcriptDir, file);
    const entries = await readJsonLines(filePath, transcriptEntrySchema);
    for (const entry of entries) if (entry.chunkFile) audio.add(safeDataPath(data, entry.chunkFile));
    affected.push(relativeDataPath(data, filePath));
  }
  for (const filePath of audio) affected.push(relativeDataPath(data, filePath));

  const notesPath = path.join(data, "oogst", "notities.jsonl");
  const notes = await readJsonLines(notesPath, oogstNotitieSchema);
  const keptNotes = notes.filter((note) => !matches(note.timestamp.slice(0, 10)));
  if (keptNotes.length !== notes.length) affected.push(relativeDataPath(data, notesPath));

  const summariesPath = path.join(data, "summaries.json");
  const summaries = z.array(z.object({ createdAt: z.string() }).passthrough()).parse(await readJson(summariesPath, []));
  const keptSummaries = summaries.filter((item) => !matches(item.createdAt.slice(0, 10)));
  if (keptSummaries.length !== summaries.length) affected.push(relativeDataPath(data, summariesPath));

  const boardPath = path.join(data, "signalen", "board-state.json");
  const board = boardStateSchema.parse(await readJson(boardPath, { pins: [] }));
  const keptPins = board.pins.filter((pin) => !matches(pin.pinnedAt.slice(0, 10)));
  if (keptPins.length !== board.pins.length) affected.push(relativeDataPath(data, boardPath));

  const dryRun = !options.confirm;
  if (!dryRun) {
    for (const relative of affected.filter((item) => item.startsWith("transcript/") || item.startsWith("audio/"))) {
      await fs.rm(safeDataPath(data, relative), { force: true });
    }
    if (keptNotes.length !== notes.length) await writeJsonLines(notesPath, keptNotes);
    if (keptSummaries.length !== summaries.length) await atomicWriteJson(summariesPath, keptSummaries);
    if (keptPins.length !== board.pins.length) await atomicWriteJson(boardPath, { pins: keptPins });
  }
  retained.push("prompts/", "signalen/bibliotheek.json", ".env files (outside data)");
  return { dryRun, affected: [...new Set(affected)].sort(), retained };
}

function selector(value: SessionSelector): (date: string) => boolean {
  if (value.date) {
    assertDate(value.date);
    return (date) => date === value.date;
  }
  if (value.olderThanDays === undefined || !Number.isInteger(value.olderThanDays) || value.olderThanDays < 0) {
    throw new Error("Provide --date YYYY-MM-DD or a non-negative --older-than day count.");
  }
  const cutoff = new Date((value.now ?? Date.now()) - value.olderThanDays * 86_400_000).toISOString().slice(0, 10);
  return (date) => date < cutoff;
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error("Date must use YYYY-MM-DD.");
  }
}

function safeDataPath(dataDir: string, relative: string): string {
  const resolved = path.resolve(dataDir, relative);
  if (!isInside(resolved, dataDir)) throw new Error(`Unsafe runtime path '${relative}'.`);
  return resolved;
}

function relativeDataPath(dataDir: string, filePath: string): string {
  return path.relative(dataDir, filePath).split(path.sep).join("/");
}

function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readJson(filePath: string, fallback: unknown): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonLines<T>(filePath: string, schema: z.ZodType<T>): Promise<T[]> {
  try {
    const lines = (await fs.readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
    return lines.flatMap((line) => {
      try {
        const parsed = schema.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeJsonLines(filePath: string, values: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, values.length ? `${values.map((value) => JSON.stringify(value)).join("\n")}\n` : "");
}
