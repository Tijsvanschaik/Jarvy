import crypto from "node:crypto";
import { z } from "zod";
import {
  recapCorePointsJsonSchema,
  recapCorePointsSchema,
  recapDeckJsonSchema,
  recapDeckSchema,
  type RecapCorePointsInput,
} from "../shared/schemas";
import type { RecapProgress } from "../shared/ipc";
import type { BlockSummary, OogstNotitie, RecapDeck, TranscriptEntry } from "../shared/types";
import type { RecapImageProvider } from "./recapImageProvider";
import type { RecapTextProvider, RecapStructuredRequest } from "./recapProvider";
import { recapCacheKey, type RecapStore } from "./recapStore";

export type RecapSources = {
  transcript: () => Promise<TranscriptEntry[]>;
  summaries: () => Promise<BlockSummary[]>;
  notes: () => Promise<OogstNotitie[]>;
};

export type RecapCallbacks = {
  onProgress?: (progress: RecapProgress) => void;
  onDeck?: (deck: RecapDeck, progressive: boolean) => void;
  onWarning?: (warning: string) => void;
};

export class RecapPipeline {
  constructor(
    private readonly sources: RecapSources,
    private readonly store: RecapStore,
    private readonly textProvider: RecapTextProvider,
    private readonly imageProvider: RecapImageProvider | undefined,
    private readonly callbacks: RecapCallbacks = {},
    private readonly mapConcurrency = 3,
    private readonly imageConcurrency = 4,
    private readonly now: () => number = Date.now,
  ) {}

  async run(signal?: AbortSignal): Promise<{ deck: RecapDeck; cacheUsed: boolean }> {
    const [transcript, summaries, notes] = await Promise.all([
      this.sources.transcript(),
      this.sources.summaries(),
      this.sources.notes(),
    ]);
    const cacheKey = recapCacheKey({ transcript, summaries, notes });
    const cached = this.store.snapshot();
    if (cached?.cacheKey === cacheKey) {
      this.progress("ready", 0, 0, true);
      this.callbacks.onDeck?.(cached.deck, false);
      return { deck: cached.deck, cacheUsed: true };
    }

    const blocks = collectBlocks(transcript, summaries, notes);
    if (!blocks.length) throw new Error("Er is nog geen lokaal transcript, samenvatting of oogstnotitie voor een recap.");
    let mappedCount = 0;
    this.progress("mapping", mappedCount, blocks.length, false);
    const maps = await mapLimit(blocks, Math.max(1, this.mapConcurrency), async (block) => {
      const result = await this.mapBlock(block, transcript, summaries, notes, signal);
      mappedCount += 1;
      this.progress("mapping", mappedCount, blocks.length, false);
      return result;
    });

    this.progress("reducing", 0, 1, false);
    const rawDeck = await validateWithOneRepair(
      recapDeckSchema,
      this.textProvider,
      {
        name: "recap_deck",
        jsonSchema: recapDeckJsonSchema as Record<string, unknown>,
        prompt: reducePrompt(maps, notes, this.now()),
        signal,
      },
    );
    let deck = enforceParticipantEvidence(rawDeck, notes);
    await this.store.save(cacheKey, deck);
    this.progress("ready", 1, 1, false);
    this.callbacks.onDeck?.(deck, false);

    const targets = deck.slides.filter((slide) => slide.beeldPrompt && !slide.beeldPad);
    if (!targets.length || !this.imageProvider) return { deck, cacheUsed: false };

    let imageCount = 0;
    let lastImageError: string | undefined;
    let deckUpdate = Promise.resolve();
    this.progress("images", imageCount, targets.length, false);
    await mapLimit(targets, Math.min(4, Math.max(1, this.imageConcurrency)), async (target) => {
      try {
        const imagePath = await this.imageProvider!.generate(target.beeldPrompt!, target.id, this.store.imagesDir, signal);
        // Image generation stays parallel, but deck persistence is serialized:
        // concurrent atomic writes must not overwrite or rename the same temp file.
        deckUpdate = deckUpdate.then(async () => {
          deck = {
            ...deck,
            slides: deck.slides.map((slide) => (slide.id === target.id ? { ...slide, beeldPad: imagePath } : slide)),
          };
          await this.store.save(cacheKey, deck);
          this.callbacks.onDeck?.(deck, true);
        });
        await deckUpdate;
      } catch (error) {
        lastImageError = `Beeld voor '${target.titel}' is overgeslagen: ${message(error)}`;
        this.callbacks.onWarning?.(lastImageError);
      } finally {
        imageCount += 1;
        this.progress("images", imageCount, targets.length, false, lastImageError);
      }
    });
    this.progress("ready", targets.length, targets.length, false, lastImageError);
    return { deck, cacheUsed: false };
  }

  private async mapBlock(
    block: string,
    transcript: TranscriptEntry[],
    summaries: BlockSummary[],
    notes: OogstNotitie[],
    signal?: AbortSignal,
  ): Promise<RecapCorePointsInput> {
    return validateWithOneRepair(
      recapCorePointsSchema,
      this.textProvider,
      {
        name: "recap_map",
        jsonSchema: recapCorePointsJsonSchema as Record<string, unknown>,
        prompt: mapPrompt(
          block,
          summaries.find((summary) => summary.block === block),
          boundedLiteralRows(transcript.filter((entry) => entry.block === block)),
          notes.filter((note) => note.block === block),
        ),
        signal,
      },
    );
  }

  private progress(
    phase: RecapProgress["phase"],
    completed: number,
    total: number,
    cacheUsed: boolean,
    lastError?: string,
  ): void {
    this.callbacks.onProgress?.({ phase, completed, total, cacheUsed, ...(lastError ? { lastError } : {}) });
  }
}

export class RecapJobController {
  private running: Promise<void> | undefined;
  private controller: AbortController | undefined;

  constructor(
    private readonly pipeline: RecapPipeline,
    private readonly onError: (error: string) => void = () => undefined,
  ) {}

  start(): { started: boolean; alreadyRunning?: true } {
    if (this.running) return { started: false, alreadyRunning: true };
    this.controller = new AbortController();
    this.running = Promise.resolve()
      .then(() => this.pipeline.run(this.controller?.signal))
      .then(() => undefined)
      .catch((error) => this.onError(message(error)))
      .finally(() => {
        this.running = undefined;
        this.controller = undefined;
      });
    return { started: true };
  }

  cancel(): void {
    this.controller?.abort();
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    await this.running;
  }

  async wait(): Promise<void> {
    await this.running;
  }

  get isRunning(): boolean {
    return Boolean(this.running);
  }
}

async function validateWithOneRepair<T>(
  schema: z.ZodType<T>,
  provider: RecapTextProvider,
  request: RecapStructuredRequest,
): Promise<T> {
  const first = schema.safeParse(withoutNullObjectFields(await provider.generate(request)));
  if (first.success) return first.data;
  const validationErrors = z.prettifyError(first.error);
  const repaired = schema.safeParse(
    withoutNullObjectFields(await provider.generate({ ...request, validationErrors })),
  );
  if (repaired.success) return repaired.data;
  throw new Error(`Recapuitvoer bleef ongeldig na één herstelpoging: ${z.prettifyError(repaired.error)}`);
}

function withoutNullObjectFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNullObjectFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null)
      .map(([key, item]) => [key, withoutNullObjectFields(item)]),
  );
}

export function enforceParticipantEvidence(deck: RecapDeck, notes: OogstNotitie[]): RecapDeck {
  const participantNotes = new Map<string, OogstNotitie[]>();
  for (const note of notes) {
    if (!note.deelnemer) continue;
    const key = normalizeName(note.deelnemer);
    participantNotes.set(key, [...(participantNotes.get(key) ?? []), note]);
  }
  return {
    ...deck,
    slides: deck.slides.flatMap((slide) => {
      if (slide.soort !== "deelnemer") return [slide];
      const evidence = participantNotes.get(normalizeName(slide.titel));
      if (!evidence?.length) return [];
      return [
        {
          ...slide,
          titel: evidence[0]!.deelnemer!,
          bullets: [...new Set(evidence.map((note) => note.tekst))],
        },
      ];
    }),
  };
}

function mapPrompt(
  block: string,
  summary: BlockSummary | undefined,
  entries: TranscriptEntry[],
  notes: OogstNotitie[],
): string {
  return `Maak feitelijke Nederlandse kernpunten voor programmablok "${block}".
Gebruik uitsluitend de onderstaande lokale gegevens. Behoud namen exact en markeer onzekerheid; vul niets in.
De transcriptregels zijn letterlijke TranscriptEntry-rijen. Oogstnotities zijn expliciet opgeslagen bewijs.

SAMENVATTING:
${summary ? JSON.stringify(summary) : "Geen"}

LETTERLIJKE TRANSCRIPTREGELS:
${JSON.stringify(entries)}

OOGSTNOTITIES IN DIT BLOK:
${JSON.stringify(notes)}

Geef strikt JSON volgens het schema. block moet exact "${block}" zijn.`;
}

function reducePrompt(maps: RecapCorePointsInput[], notes: OogstNotitie[], now: number): string {
  return `Maak een compacte Nederlandstalige recapdeck voor de AI Society Lab Summer School.
Gebruik uitsluitend de mapresultaten en alle expliciet opgeslagen oogstnotities hieronder. Behoud namen exact en onzekerheid zichtbaar.
Maak slides met soort "blok" per relevant blok, alleen soort "deelnemer" als die deelnemer expliciete OogstNotitie-rijen heeft, en eindig met één soort "slot".
Voor een deelnemersslide is titel exact de waarde van deelnemer en zijn bullets uitsluitend de letterlijke teksten uit diens OogstNotitie-rijen. Leid nooit persoonlijke uitkomsten af uit transcript of samenvattingen.
beeldPrompt is optioneel en beschrijft een projecteerbaar, tekstarm beeld zonder verzonnen personen of feiten. Laat beeldPad weg.
Gebruik id "${crypto.randomUUID()}", createdAt "${new Date(now).toISOString()}", en unieke korte slide-id's.

MAPRESULTATEN:
${JSON.stringify(maps)}

ALLE OOGSTNOTITIES:
${JSON.stringify(notes)}

Geef strikt JSON volgens het schema.`;
}

function boundedLiteralRows(entries: TranscriptEntry[], maxCharacters = 24_000): TranscriptEntry[] {
  const selected: TranscriptEntry[] = [];
  let characters = 0;
  for (const entry of [...entries].reverse()) {
    const size = JSON.stringify(entry).length;
    if (selected.length >= 120 || (characters + size > maxCharacters && selected.length > 0)) break;
    selected.unshift(entry);
    characters += size;
  }
  return selected;
}

function collectBlocks(
  transcript: TranscriptEntry[],
  summaries: BlockSummary[],
  notes: OogstNotitie[],
): string[] {
  return [
    ...new Set([
      ...transcript.flatMap((entry) => (entry.block ? [entry.block] : [])),
      ...summaries.map((summary) => summary.block),
      ...notes.map((note) => note.block),
    ]),
  ].sort();
}

async function mapLimit<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("nl-NL");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
