import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BoardStore } from "./boardStore";
import { SignalStore } from "./signalStore";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("BoardStore", () => {
  it("validates pins and restores atomically persisted board state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-board-"));
    roots.push(root);
    const library = path.join(root, "library.json");
    await fs.writeFile(library, JSON.stringify([{
      id: "demo-een", titel: "Demo", laag: 1, domein: "sociaal", type: "zacht",
      kernfeit: "Sample", bron: "demo", jaar: "demo", beleidsvraag: "Vraag?", uitlegKort: "Kort",
    }]));
    const signals = new SignalStore(library, library);
    await signals.reload();
    const file = path.join(root, "board.json");
    const board = new BoardStore(file, signals);
    await board.load();
    const pin = await board.pin({ signaalId: "demo-een", domein: "sociaal", notitie: "Routine 2" });
    expect(pin.signaal?.laag).toBe(1);
    await expect(board.pin({ signaalId: "onbekend", domein: "zorg" })).rejects.toThrow("Unknown signal");

    const recovered = new BoardStore(file, signals);
    await recovered.load();
    expect(recovered.snapshot().pins[0].notitie).toBe("Routine 2");
  });

  it("quarantines corrupt board state and starts empty", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiden-board-corrupt-"));
    roots.push(root);
    const library = path.join(root, "library.json");
    await fs.writeFile(library, "[]");
    const signals = new SignalStore(library, library);
    await signals.reload();
    const file = path.join(root, "board.json");
    await fs.writeFile(file, "{broken");
    const warnings: string[] = [];
    const board = new BoardStore(file, signals, (warning) => warnings.push(warning));
    await expect(board.load()).resolves.toBeUndefined();
    expect(board.snapshot().pins).toEqual([]);
    expect(warnings.some((warning) => warning.includes("quarantined"))).toBe(true);
  });
});
