import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { oogstNotitieSchema } from "../shared/schemas";
import type { OogstNotitie } from "../shared/types";
import type { ConfigStore } from "./configStore";

export class NotesStore {
  private notes: OogstNotitie[] = [];
  private appendQueue = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly config: ConfigStore,
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  static inDataDir(dataDir: string, config: ConfigStore, warn?: (message: string) => void): NotesStore {
    return new NotesStore(path.join(dataDir, "oogst", "notities.jsonl"), config, warn);
  }

  async load(): Promise<void> {
    try {
      const lines = (await fs.readFile(this.filePath, "utf8")).split(/\r?\n/);
      this.notes = lines.flatMap((line, index) => {
        if (!line.trim()) return [];
        const parsed = oogstNotitieSchema.safeParse(safeJson(line));
        if (parsed.success) return [parsed.data];
        this.warn(`Skipped corrupt note line notities.jsonl:${index + 1}.`);
        return [];
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.notes = [];
        return;
      }
      throw error;
    }
  }

  async list(): Promise<OogstNotitie[]> {
    return [...this.notes];
  }

  get count(): number {
    return this.notes.length;
  }

  async append(input: {
    deelnemer?: string;
    type: OogstNotitie["type"];
    tekst: string;
  }): Promise<OogstNotitie> {
    const note = oogstNotitieSchema.parse({
      id: crypto.randomUUID(),
      deelnemer: input.deelnemer,
      type: input.type,
      tekst: input.tekst,
      block: this.config.currentBlock,
      timestamp: new Date().toISOString(),
    });
    const operation = this.appendQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const handle = await fs.open(this.filePath, "a");
      try {
        await handle.writeFile(`${JSON.stringify(note)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.notes.push(note);
      return note;
    });
    this.appendQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}
