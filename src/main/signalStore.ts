import fs from "node:fs/promises";
import path from "node:path";
import { signalLibrarySchema } from "../shared/schemas";
import type { Signaal } from "../shared/types";

export class SignalStore {
  private signals: Signaal[] = [];
  private index = new Map<string, Signaal>();
  private warningMessages: string[] = [];

  constructor(
    private readonly runtimePath: string,
    private readonly defaultsPath: string,
    private readonly warn: (message: string) => void = () => undefined,
  ) {}

  static inDataDir(dataDir: string, repoRoot: string, warn?: (message: string) => void): SignalStore {
    return new SignalStore(
      path.join(dataDir, "signalen", "bibliotheek.json"),
      path.join(repoRoot, "assets", "signalen", "bibliotheek.sample.json"),
      warn,
    );
  }

  async bootstrap(): Promise<void> {
    await fs.mkdir(path.dirname(this.runtimePath), { recursive: true });
    try {
      await fs.access(this.runtimePath);
    } catch {
      await fs.copyFile(this.defaultsPath, this.runtimePath);
    }
    try {
      await this.reload();
    } catch {
      // Keep the app operable with an empty index; reload already surfaced the schema warning.
    }
  }

  async reload(): Promise<void> {
    let parsed: Signaal[];
    try {
      parsed = signalLibrarySchema.parse(JSON.parse(await fs.readFile(this.runtimePath, "utf8")));
    } catch (error) {
      const message = `Signal library validation failed: ${error instanceof Error ? error.message : String(error)}`;
      this.warningMessages = [message];
      this.warn(message);
      throw error;
    }
    const index = new Map<string, Signaal>();
    const warnings: string[] = [];
    for (const signal of parsed) {
      if (index.has(signal.id)) {
        warnings.push(`Duplicate signal id '${signal.id}' skipped.`);
        continue;
      }
      index.set(signal.id, signal);
    }
    this.index = index;
    this.signals = [...index.values()];
    this.warningMessages = warnings;
    warnings.forEach(this.warn);
  }

  async find(id: string): Promise<Signaal | undefined> {
    await this.reload();
    return this.index.get(id);
  }

  list(): Signaal[] {
    return [...this.signals];
  }

  compactIndex(): Array<Pick<Signaal, "id" | "titel" | "laag" | "domein" | "type">> {
    return this.signals.map(({ id, titel, laag, domein, type }) => ({ id, titel, laag, domein, type }));
  }

  get warnings(): string[] {
    return [...this.warningMessages];
  }
}
