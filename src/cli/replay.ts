import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { BoardStore } from "../main/boardStore";
import { ConfigStore } from "../main/configStore";
import { ContextBuilder } from "../main/contextBuilder";
import { NotesStore } from "../main/notesStore";
import { PromptLoader } from "../main/promptLoader";
import { RecapJobController, RecapPipeline } from "../main/recapPipeline";
import type { RecapStructuredRequest, RecapTextProvider } from "../main/recapProvider";
import { RecapStore } from "../main/recapStore";
import { SignalStore } from "../main/signalStore";
import { SummaryScheduler, SummaryStore, type SummaryProvider } from "../main/summaryScheduler";
import { createTargetToolHost } from "../main/targetTools";
import { TranscriptStore } from "../main/transcriptStore";
import {
  OpenAITranscriptionTransport,
  TranscriptionQueue,
  type TranscriptionTransport,
} from "../main/transcriptionQueue";
import { replayWav } from "../renderer/audio/replay";
import { encodeMonoPcm16Wav } from "../renderer/audio/wav";
import type { AidenToolResult, RecapDeck } from "../shared/types";

const fixtureSchema = z.object({
  version: z.literal(1),
  chunks: z.array(z.object({ block: z.string().min(1), text: z.string().min(1) })).min(5),
  activations: z.array(z.object({ afterChunk: z.number().int().nonnegative(), source: z.literal("script") })),
  visionText: z.string().min(1),
  supportedParticipant: z.object({ name: z.string().min(1), claim: z.string().min(1) }),
  unsupportedParticipant: z.object({ name: z.string().min(1), claim: z.string().min(1) }),
});
type Fixture = z.infer<typeof fixtureSchema>;

export type ReplayOptions = {
  file: string;
  speed?: number;
  block?: string;
  offlineFixtures?: string;
  debugTranscripts?: boolean;
  dataDir?: string;
  repoRoot?: string;
};

export type ReplayReport = {
  ok: boolean;
  mode: "offline" | "normal";
  chunks: number;
  transcripts: number;
  retries: number;
  errors: string[];
  activations: number;
  unsolicitedActivations: number;
  context: {
    totalTokens: number;
    sections: Array<{ id: string; tokens: number; budget: number; truncated: boolean }>;
    warnings: string[];
  };
  boardPins: number;
  notes: number;
  recap: { slides: number; evidenceRejections: number; progressiveUpdates: number; cacheUsed: boolean };
  toolOrder: string[];
  elapsedMs: number;
  transcriptExcerpts?: string[];
};

export async function runReplay(options: ReplayOptions): Promise<ReplayReport> {
  const started = performance.now();
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const dataDir = path.resolve(options.dataDir ?? path.join(repoRoot, "data"));
  const speed = options.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0) throw new Error("--speed must be a positive number.");
  const wav = await fs.readFile(path.resolve(options.file));
  const chunks = replayWav(toArrayBuffer(wav), isSpeech);
  if (!chunks.length) throw new Error("Replay produced no chunks; ensure the PCM WAV contains speech-like energy.");

  const warnings: string[] = [];
  const fixture = options.offlineFixtures
    ? fixtureSchema.parse(JSON.parse(await fs.readFile(path.resolve(options.offlineFixtures), "utf8")))
    : undefined;
  if (fixture && fixture.chunks.length !== chunks.length) {
    throw new Error(`Offline fixture has ${fixture.chunks.length} transcripts but WAV produced ${chunks.length} chunks.`);
  }

  const paths = {
    repoRoot,
    dataDir,
    promptDefaultsDir: path.join(repoRoot, "prompts"),
    runtimePromptsDir: path.join(dataDir, "prompts"),
  };
  const config = ConfigStore.inDataDir(dataDir);
  const transcript = new TranscriptStore(path.join(dataDir, "transcript"), (message) => warnings.push(message));
  const summaries = SummaryStore.inDataDir(dataDir, (message) => warnings.push(message));
  const notes = NotesStore.inDataDir(dataDir, config, (message) => warnings.push(message));
  const signals = SignalStore.inDataDir(dataDir, repoRoot, (message) => warnings.push(message));
  const board = BoardStore.inDataDir(dataDir, signals, (message) => warnings.push(message));
  const recapStore = RecapStore.inDataDir(dataDir, (message) => warnings.push(message));
  await Promise.all([
    new PromptLoader(paths, (message) => warnings.push(message)).bootstrap(),
    config.load(),
    transcript.load(),
    summaries.load(),
    notes.load(),
    signals.bootstrap(),
    board.load(),
    recapStore.load(),
  ]);

  let fixtureIndex = 0;
  let retryCount = 0;
  const errors: string[] = [];
  const transport: TranscriptionTransport = fixture
    ? {
        transcribe: async () => {
          const item = fixture.chunks[fixtureIndex++];
          if (!item) throw new Error("Missing offline transcript fixture.");
          return item.text;
        },
      }
    : new OpenAITranscriptionTransport(
        () => process.env.OPENAI_API_KEY,
        fetch,
        process.env.AIDEN_TRANSCRIPTION_MODEL,
        process.env.AIDEN_TRANSCRIPTION_FALLBACK_MODEL,
      );
  let currentBlock = options.block ?? fixture?.chunks[0]?.block ?? "replay";
  let id = 0;
  const queue = new TranscriptionQueue({
    dataDir,
    transcript,
    transport: {
      transcribe: async (request) => {
        try {
          return await transport.transcribe(request);
        } catch (error) {
          retryCount += 1;
          throw error;
        }
      },
    },
    currentBlock: () => currentBlock,
    concurrency: 1,
    idFactory: () => `replay-${String(++id).padStart(3, "0")}`,
    sleep: fixture ? async () => undefined : undefined,
    warn: (message) => warnings.push(message),
  });
  await queue.load();
  for (const [index, chunk] of chunks.entries()) {
    currentBlock = fixture?.chunks[index]?.block ?? options.block ?? "replay";
    await queue.enqueue(
      encodeMonoPcm16Wav(chunk.samples),
      1_767_225_600_000 + chunk.tsStart / speed,
      1_767_225_600_000 + chunk.tsEnd / speed,
    );
  }
  await queue.waitForIdle();

  const summaryProvider: SummaryProvider = fixture
    ? {
        summarize: async ({ block, entries }) =>
          `Feitelijke offline samenvatting voor ${block}; ${entries.length} transcriptregel(s).`,
      }
    : {
        summarize: async () => {
          throw new Error("Normal replay leaves summary generation to the configured application scheduler.");
        },
      };
  if (fixture) {
    const latest = Math.max(...(await transcript.list()).map((entry) => entry.tsEnd));
    const scheduler = new SummaryScheduler(transcript, summaries, summaryProvider, () => latest + 16 * 60_000);
    await scheduler.run();
    await scheduler.stop();
  }

  const toolOrder: string[] = [];
  const progressiveDecks: RecapDeck[] = [];
  let finalDeck: RecapDeck | undefined;
  const textProvider = fixture ? new OfflineRecapProvider(fixture) : undefined;
  const recapPipeline = fixture
    ? new RecapPipeline(
        {
          transcript: () => transcript.list(),
          summaries: () => summaries.list(),
          notes: () => notes.list(),
        },
        recapStore,
        textProvider!,
        {
          generate: async (_prompt, slideId, imagesDir) => {
            await fs.mkdir(imagesDir, { recursive: true });
            const imagePath = path.join(imagesDir, `${slideId}.fixture-image.txt`);
            await fs.writeFile(imagePath, "offline fixture image; no personal data\n");
            return imagePath;
          },
        },
        {
          onDeck: (deck) => {
            finalDeck = deck;
            progressiveDecks.push(structuredClone(deck));
          },
          onWarning: (message) => warnings.push(message),
        },
        1,
        1,
        () => 1_767_226_600_000,
      )
    : undefined;
  const recapJob = recapPipeline ? new RecapJobController(recapPipeline, (error) => errors.push(error)) : undefined;
  const host = createTargetToolHost({
    signals,
    board,
    notes,
    generateImage: async () => ({ ok: true, artifact: { title: "Visueel cv", kind: "image", content: "offline://cv" } }),
    searchWeb: async () => ({ ok: false, error: "Web fallback is disabled in deterministic rehearsal." }),
    cameraVision: fixture ? { enabled: true, look: async () => fixture.visionText } : undefined,
    recap: recapJob ? { enabled: true, start: () => recapJob.start() } : undefined,
  });
  const invoke = async (name: string, args: Record<string, unknown>): Promise<AidenToolResult> => {
    toolOrder.push(name);
    const result = await host.invoke(name, args);
    if (!result.ok) errors.push(`${name}: ${String(result.error ?? "failed")}`);
    return result;
  };

  let activations = 0;
  if (fixture) {
    // These are explicit scripted/hotkey-equivalent activations; replay audio itself never activates Realtime.
    for (const activation of fixture.activations) if (activation.source === "script") activations += 1;
    await invoke("genereer_beeld", { prompt: "Abstract, privacy-safe visual CV", size: "1024x1024" });
    await invoke("zoek_signaal", { id: "demo-laag-1-buurtcheck" });
    await invoke("toon_op_bord", { signaalId: "demo-laag-1-buurtcheck", domein: "sociaal" });
    await config.setBlock("3-laag-2-provisioneel");
    await invoke("maak_notitie", {
      type: "aanname",
      tekst: "Routine 3 is provisioneel; er is geen gemeentelijk systeem geïmplementeerd.",
    });
    await invoke("kijk_mee", { frames: 1 });
    await config.setBlock("5-recap");
    await invoke("maak_notitie", {
      deelnemer: fixture.supportedParticipant.name,
      type: "inzicht",
      tekst: fixture.supportedParticipant.claim,
    });
    await invoke("start_recap", {});
    await recapJob!.wait();
  }

  const context = await new ContextBuilder(new PromptLoader(paths), { summaries, transcript, notes }).build();
  const transcriptEntries = await transcript.list();
  const participantSlidesBefore = textProvider?.participantSlides ?? 0;
  const participantSlidesAfter = finalDeck?.slides.filter((slide) => slide.soort === "deelnemer").length ?? 0;
  const report: ReplayReport = {
    ok:
      errors.length === 0 &&
      (!fixture ||
        (chunks.length === 5 &&
          transcriptEntries.length === 5 &&
          board.snapshot().pins.length === 1 &&
          participantSlidesBefore - participantSlidesAfter === 1 &&
          toolOrder.indexOf("zoek_signaal") < toolOrder.indexOf("toon_op_bord"))),
    mode: fixture ? "offline" : "normal",
    chunks: chunks.length,
    transcripts: transcriptEntries.length,
    retries: retryCount,
    errors,
    activations,
    unsolicitedActivations: 0,
    context: {
      totalTokens: context.totalTokens,
      sections: context.sections,
      warnings: [...context.warnings, ...warnings],
    },
    boardPins: board.snapshot().pins.length,
    notes: (await notes.list()).length,
    recap: {
      slides: finalDeck?.slides.length ?? 0,
      evidenceRejections: Math.max(0, participantSlidesBefore - participantSlidesAfter),
      progressiveUpdates: progressiveDecks.length,
      cacheUsed: false,
    },
    toolOrder,
    elapsedMs: Math.round(performance.now() - started),
    ...(options.debugTranscripts ? { transcriptExcerpts: transcriptEntries.map((entry) => entry.text.slice(0, 160)) } : {}),
  };
  await queue.shutdown();
  return report;
}

class OfflineRecapProvider implements RecapTextProvider {
  participantSlides = 0;
  constructor(private readonly fixture: Fixture) {}

  async generate(request: RecapStructuredRequest): Promise<unknown> {
    if (request.name === "recap_map") {
      const block = /programmablok "([^"]+)"/.exec(request.prompt)?.[1] ?? "onbekend";
      return { block, kernpunten: [`Offline kernpunt voor ${block}`], onzekerheden: [] };
    }
    this.participantSlides = 2;
    return {
      id: "offline-recap",
      createdAt: "2026-01-01T00:16:40.000Z",
      slides: [
        { id: "intro", soort: "blok", titel: "Vijf routines", bullets: ["Deterministische offline rehearsal"], beeldPrompt: "abstracte vijf stappen" },
        {
          id: "supported",
          soort: "deelnemer",
          titel: this.fixture.supportedParticipant.name,
          bullets: [this.fixture.supportedParticipant.claim],
        },
        {
          id: "unsupported",
          soort: "deelnemer",
          titel: this.fixture.unsupportedParticipant.name,
          bullets: [this.fixture.unsupportedParticipant.claim],
        },
        { id: "slot", soort: "slot", titel: "Slot", bullets: ["Evidence blijft leidend"], beeldPrompt: "abstract bewijs" },
      ],
    };
  }
}

function isSpeech(frame: Float32Array): boolean {
  let energy = 0;
  for (const sample of frame) energy += sample * sample;
  return Math.sqrt(energy / Math.max(1, frame.length)) >= 0.02;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export function generateSyntheticRehearsalWav(chunks = 5): ArrayBuffer {
  const sampleRate = 16_000;
  const samples: number[] = [];
  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const frequency = 220 + chunk * 40;
    for (let index = 0; index < sampleRate * 5.2; index += 1) {
      samples.push(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.12);
    }
    for (let index = 0; index < sampleRate * 0.8; index += 1) samples.push(0);
  }
  return encodeMonoPcm16Wav(Float32Array.from(samples), sampleRate);
}

async function main(): Promise<void> {
  await loadLocalEnv(path.join(process.cwd(), ".env.local"));
  const args = parseArgs(process.argv.slice(2));
  let temporary: string | undefined;
  if (args.generateFixture) {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "aiden-rehearsal-"));
    args.file = path.join(temporary, "synthetic.wav");
    args.dataDir ??= path.join(temporary, "data");
    await fs.writeFile(args.file, new Uint8Array(generateSyntheticRehearsalWav()));
  }
  try {
    if (!args.file) throw new Error("Usage: npm run replay -- --file <wav> [--speed N] [--block X] [--offline-fixtures path]");
    const report = await runReplay({
      file: args.file,
      speed: args.speed,
      block: args.block,
      offlineFixtures: args.offlineFixtures,
      debugTranscripts: args.debugTranscripts,
      dataDir: args.dataDir,
    });
    console.log(`Aiden replay: ${report.chunks} chunks, ${report.transcripts} transcripts, ${report.recap.slides} recap slides, ${report.errors.length} errors.`);
    console.log(`AIDEN_REPLAY_REPORT=${JSON.stringify(report)}`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
  }
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

function parseArgs(argv: string[]) {
  const parsed: {
    file?: string;
    speed?: number;
    block?: string;
    offlineFixtures?: string;
    debugTranscripts?: boolean;
    dataDir?: string;
    generateFixture?: boolean;
  } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]!;
    if (name === "--debug-transcripts") parsed.debugTranscripts = true;
    else if (name === "--generate-fixture") parsed.generateFixture = true;
    else {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${name}.`);
      if (name === "--file") parsed.file = value;
      else if (name === "--speed") parsed.speed = Number(value);
      else if (name === "--block") parsed.block = value;
      else if (name === "--offline-fixtures") parsed.offlineFixtures = value;
      else if (name === "--data-dir") parsed.dataDir = value;
      else throw new Error(`Unknown argument ${name}.`);
    }
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  void main().catch((error) => {
    console.error(`Replay failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
