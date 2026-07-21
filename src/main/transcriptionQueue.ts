import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { TranscriptEntry } from "../shared/types";
import { atomicWriteJson, quarantineFile, readJsonFileRecovering } from "./persistence";
import type { TranscriptStore } from "./transcriptStore";

const jobSchema = z.object({
  id: z.string().min(1),
  tsStart: z.number().finite().nonnegative(),
  tsEnd: z.number().finite().nonnegative(),
  chunkFile: z.string().min(1),
  block: z.string().min(1),
  status: z.enum(["pending", "active", "completed", "failed"]),
  attempts: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  text: z.string().optional(),
  error: z.string().optional(),
});
const manifestSchema = z.object({ jobs: z.array(jobSchema) });
export type TranscriptionJob = z.infer<typeof jobSchema>;

export type TranscriptionRequest = {
  wavPath: string;
  prompt: string;
  language: string;
};

export type TranscriptionTransport = {
  transcribe: (request: TranscriptionRequest) => Promise<string>;
};

export type QueueOpsState = {
  depth: number;
  active: number;
  lastError?: string;
  oldestPendingTs?: number;
};

export type TranscriptionQueueOptions = {
  dataDir: string;
  transcript: TranscriptStore;
  transport: TranscriptionTransport;
  currentBlock: () => string;
  vocabulary?: string[];
  concurrency?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onState?: (state: QueueOpsState) => void;
  onTranscript?: (entry: TranscriptEntry) => void;
  warn?: (message: string) => void;
  idFactory?: () => string;
};

export class TranscriptionQueue {
  private readonly chunksDir: string;
  private readonly manifestPath: string;
  private readonly concurrency: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private jobs: TranscriptionJob[] = [];
  private active = 0;
  private lastError: string | undefined;
  private persistence = Promise.resolve();
  private flushing = Promise.resolve();
  private accepting = true;

  constructor(private readonly options: TranscriptionQueueOptions) {
    this.chunksDir = path.join(options.dataDir, "audio", "chunks");
    this.manifestPath = path.join(options.dataDir, "audio", "queue.json");
    this.concurrency = options.concurrency ?? 2;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async load(): Promise<void> {
    const raw = await readJsonFileRecovering(this.manifestPath, this.options.warn);
    const parsed = manifestSchema.safeParse(raw ?? { jobs: [] });
    if (!parsed.success) {
      this.options.warn?.("Transcription queue state was invalid; the raw file was quarantined and an empty queue started.");
      await quarantineFile(this.manifestPath, this.options.warn ?? (() => undefined));
    }
    const manifest = parsed.success ? parsed.data : { jobs: [] };
    this.jobs = manifest.jobs
      .map((job) => (job.status === "active" ? { ...job, status: "pending" as const } : job))
      .sort(compareJobs);
    await this.persist();
    await this.flushCompleted();
    this.emitState();
    this.pump();
  }

  async enqueue(wav: ArrayBuffer, tsStart: number, tsEnd: number): Promise<TranscriptionJob> {
    if (!this.accepting) throw new Error("Transcription queue is shutting down and no longer accepts audio.");
    if (!(wav instanceof ArrayBuffer) || wav.byteLength < 44 || wav.byteLength > 64 * 1024 * 1024) {
      throw new Error("Invalid audio chunk buffer.");
    }
    if (!Number.isFinite(tsStart) || !Number.isFinite(tsEnd) || tsStart < 0 || tsEnd <= tsStart) {
      throw new Error("Invalid audio chunk timestamps.");
    }
    await fs.mkdir(this.chunksDir, { recursive: true });
    const id = this.options.idFactory?.() ?? crypto.randomUUID();
    const stamp = new Date(tsStart).toISOString().replace(/[:.]/g, "-");
    const chunkFile = `${stamp}-${id}.wav`;
    const wavPath = path.join(this.chunksDir, chunkFile);
    const handle = await fs.open(wavPath, "wx");
    try {
      await handle.writeFile(new Uint8Array(wav));
      await handle.sync();
    } finally {
      await handle.close();
    }

    const job: TranscriptionJob = {
      id,
      tsStart,
      tsEnd,
      chunkFile,
      block: this.options.currentBlock(),
      status: "pending",
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    this.jobs.push(job);
    this.jobs.sort(compareJobs);
    await this.persist();
    this.emitState();
    this.pump();
    return job;
  }

  get state(): QueueOpsState {
    const outstanding = this.jobs.filter((job) => job.status === "pending" || job.status === "active");
    return {
      depth: outstanding.length,
      active: this.active,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(outstanding.length ? { oldestPendingTs: Math.min(...outstanding.map((job) => job.tsStart)) } : {}),
    };
  }

  async waitForIdle(): Promise<void> {
    while (this.active > 0 || this.jobs.some((job) => job.status === "pending")) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await this.flushing;
    await this.persistence;
  }

  async shutdown(options: { drain?: boolean } = {}): Promise<void> {
    this.accepting = false;
    if (options.drain) await this.waitForIdle();
    await this.persistence;
    await this.flushing;
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const job = this.jobs.find((candidate) => candidate.status === "pending");
      if (!job) break;
      job.status = "active";
      this.active += 1;
      void this.persist();
      this.emitState();
      void this.process(job);
    }
  }

  private async process(job: TranscriptionJob): Promise<void> {
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        job.attempts = attempt;
        await this.persist();
        try {
          job.text = (await this.options.transport.transcribe({
            wavPath: path.join(this.chunksDir, job.chunkFile),
            language: "nl",
            prompt: buildVocabularyPrompt(this.options.vocabulary),
          })).trim();
          if (!job.text) throw new TranscriptionError("Transcription returned empty text.", false);
          job.status = "completed";
          job.error = undefined;
          this.lastError = undefined;
          await this.persist();
          break;
        } catch (error) {
          const failure = asTranscriptionError(error);
          job.error = failure.message;
          this.lastError = failure.message;
          await this.persist();
          this.emitState();
          if (!failure.transient || attempt === 5) {
            job.status = "failed";
            await this.persist();
            break;
          }
          await this.sleep(1_000 * 2 ** (attempt - 1));
        }
      }
    } finally {
      this.active -= 1;
      this.flushing = this.flushing.then(() => this.flushCompleted());
      await this.flushing;
      this.emitState();
      this.pump();
    }
  }

  private async flushCompleted(): Promise<void> {
    for (const job of [...this.jobs].sort(compareJobs)) {
      if (job.status === "pending" || job.status === "active") break;
      if (job.status === "failed") continue;
      if (job.status !== "completed" || !job.text) continue;
      const entry: TranscriptEntry = {
        id: job.id,
        tsStart: job.tsStart,
        tsEnd: job.tsEnd,
        text: job.text,
        source: "room",
        block: job.block,
        chunkFile: path.join("audio", "chunks", job.chunkFile),
      };
      await this.options.transcript.append(entry);
      this.options.onTranscript?.(entry);
      this.jobs = this.jobs.filter((candidate) => candidate.id !== job.id);
      await this.persist();
    }
  }

  private persist(): Promise<void> {
    const operation = this.persistence.then(() => atomicWriteJson(this.manifestPath, { jobs: this.jobs }));
    this.persistence = operation.catch(() => undefined);
    return operation;
  }

  private emitState(): void {
    this.options.onState?.(this.state);
  }
}

export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

export class OpenAITranscriptionTransport implements TranscriptionTransport {
  constructor(
    private readonly apiKey: () => string | undefined,
    private readonly fetcher: typeof fetch = fetch,
    private readonly model = "gpt-4o-mini-transcribe",
    private readonly fallbackModel = "whisper-1",
    private readonly timeoutMs = 60_000,
  ) {}

  async transcribe(request: TranscriptionRequest): Promise<string> {
    const key = this.apiKey();
    if (!key) throw new TranscriptionError("OPENAI_API_KEY is missing in .env.local.", false);
    const first = await this.post(request, this.model, key);
    if (first.unsupportedModel && this.fallbackModel) {
      return (await this.post(request, this.fallbackModel, key)).text;
    }
    return first.text;
  }

  private async post(
    request: TranscriptionRequest,
    model: string,
    key: string,
  ): Promise<{ text: string; unsupportedModel: boolean }> {
    const bytes = await fs.readFile(request.wavPath);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "audio/wav" }), path.basename(request.wavPath));
    form.append("model", model);
    form.append("language", request.language);
    form.append("response_format", "json");
    form.append("prompt", request.prompt);
    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      response = await this.fetcher("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      throw new TranscriptionError(
        (error as Error).name === "AbortError" ? "Transcription timed out." : "Transcription network failure.",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
    const body = await response.text();
    if (!response.ok) {
      const unsupportedModel =
        (response.status === 400 || response.status === 404) &&
        (/model.{0,120}(not found|unsupported|does not exist|not available)/i.test(body) ||
          /(not found|unsupported|does not exist|not available).{0,120}model/i.test(body));
      if (unsupportedModel) return { text: "", unsupportedModel: true };
      throw new TranscriptionError(
        `Transcription failed (${providerGuidance(response.status)}).`,
        response.status === 429 || response.status >= 500,
      );
    }
    try {
      const parsed = JSON.parse(body) as { text?: unknown };
      if (typeof parsed.text !== "string") throw new Error("Missing text");
      return { text: parsed.text, unsupportedModel: false };
    } catch {
      throw new TranscriptionError("Transcription response was not valid JSON text.", false);
    }
  }
}

function providerGuidance(status: number): string {
  if (status === 401 || status === 403) return `auth ${status}; verify API key`;
  if (status === 429) return "quota/rate limit 429; review billing";
  if (status >= 500) return `provider/network ${status}; retry`;
  return `HTTP ${status}; verify audio/model configuration`;
}

function asTranscriptionError(error: unknown): TranscriptionError {
  return error instanceof TranscriptionError
    ? error
    : new TranscriptionError(error instanceof Error ? error.message : String(error), false);
}

function compareJobs(left: TranscriptionJob, right: TranscriptionJob): number {
  return left.tsStart - right.tsStart || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function buildVocabularyPrompt(extra: string[] = []): string {
  return [
    "Gebruik de juiste spelling voor deze Nederlandse namen en termen:",
    "AI Society Lab, drielagenmodel, beleidsdomein, KCC, systeemverandering",
    ...extra,
  ].join(" ");
}
