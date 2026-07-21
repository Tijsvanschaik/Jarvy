import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseRecapDeck, RecapDeck } from "./RecapDeck";

const deck = {
  id: "deck",
  createdAt: "2026-08-27T12:00:00.000Z",
  slides: [
    {
      id: "jan",
      soort: "deelnemer" as const,
      titel: "Jan",
      bullets: ["Begint met een kleine proef."],
      beeldPrompt: "abstract beeld",
    },
  ],
};

describe("RecapDeck", () => {
  it("renders participant distinction and progressive image state", () => {
    const html = renderToStaticMarkup(<RecapDeck deck={deck} />);
    expect(html).toContain("recap-deelnemer");
    expect(html).toContain("Deelnemer");
    expect(html).toContain("Begint met een kleine proef.");
    expect(html).toContain("Beeld volgt");
  });

  it("strictly parses deck artifacts", () => {
    expect(parseRecapDeck(JSON.stringify(deck))).toEqual(deck);
    expect(parseRecapDeck(JSON.stringify({ ...deck, extra: true }))).toBeUndefined();
  });
});
