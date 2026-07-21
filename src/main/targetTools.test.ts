import { describe, expect, it } from "vitest";
import { createTargetToolHost } from "./targetTools";

describe("target Aiden registry", () => {
  it("exposes only target tools and builds the signal index dynamically", async () => {
    const signals = {
      compactIndex: () => [{ id: "demo-een", titel: "Demo", laag: 1, domein: "sociaal", type: "zacht" }],
      find: async () => undefined,
    };
    const host = createTargetToolHost({
      signals: signals as never,
      board: {} as never,
      notes: {} as never,
      generateImage: async () => ({ ok: true }),
      searchWeb: async () => ({ ok: true }),
    });
    expect(host.specs().map((spec) => spec.name)).toEqual([
      "zoek_signaal", "toon_op_bord", "maak_notitie", "genereer_beeld", "zoek_web",
    ]);
    expect(host.specs()[0].description).toContain("demo-een");
    expect(await host.invoke("zoek_signaal", { id: "onbekend" })).toMatchObject({
      ok: false,
      validIndex: [{ id: "demo-een" }],
    });
  });
});
