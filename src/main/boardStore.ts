import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { boardStateSchema, domeinSchema } from "../shared/schemas";
import type { BoardPin, Signaal } from "../shared/types";
import { atomicWriteJson, readJsonFile } from "./persistence";
import type { SignalStore } from "./signalStore";

export type PinRequest = {
  signaalId?: string;
  beeldPad?: string;
  domein: Signaal["domein"];
  notitie?: string;
};

export class BoardStore {
  private pins: BoardPin[] = [];
  private writes = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly signals: SignalStore,
  ) {}

  static inDataDir(dataDir: string, signals: SignalStore): BoardStore {
    return new BoardStore(path.join(dataDir, "signalen", "board-state.json"), signals);
  }

  async load(): Promise<void> {
    this.pins = boardStateSchema.parse((await readJsonFile(this.filePath)) ?? { pins: [] }).pins;
  }

  snapshot(): { pins: BoardPin[] } {
    return { pins: this.pins.map((pin) => ({ ...pin })) };
  }

  async pin(request: PinRequest): Promise<BoardPin> {
    const domein = domeinSchema.parse(request.domein);
    if (Boolean(request.signaalId) === Boolean(request.beeldPad)) {
      throw new Error("Provide exactly one of signaalId or beeldPad.");
    }
    let signal: Signaal | undefined;
    let imagePath: string | undefined;
    if (request.signaalId) {
      signal = await this.signals.find(request.signaalId);
      if (!signal) throw new Error(`Unknown signal '${request.signaalId}'.`);
    } else {
      if (/^(data:|https?:)/i.test(request.beeldPad ?? "")) throw new Error("beeldPad must reference a local file.");
      imagePath = path.resolve(request.beeldPad!);
      const stat = await fs.stat(imagePath).catch(() => undefined);
      if (!stat?.isFile()) throw new Error(`Image path does not exist: ${imagePath}`);
    }
    const pin: BoardPin = {
      id: crypto.randomUUID(),
      ...(signal ? { signaalId: signal.id, signaal: signal } : { beeldPad: imagePath }),
      domein,
      ...(request.notitie?.trim() ? { notitie: request.notitie.trim() } : {}),
      pinnedAt: new Date().toISOString(),
    };
    await this.update([...this.pins, pin]);
    return pin;
  }

  async remove(id: string): Promise<boolean> {
    const next = this.pins.filter((pin) => pin.id !== id);
    if (next.length === this.pins.length) return false;
    await this.update(next);
    return true;
  }

  async clear(): Promise<void> {
    await this.update([]);
  }

  private async update(pins: BoardPin[]): Promise<void> {
    const state = boardStateSchema.parse({ pins });
    const operation = this.writes.then(() => atomicWriteJson(this.filePath, state));
    this.writes = operation.catch(() => undefined);
    await operation;
    this.pins = state.pins;
  }
}
