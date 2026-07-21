import { describe, expect, it } from "vitest";
import type { PromptLoader, PromptSet } from "./promptLoader";
import { CONTEXT_BUDGETS, ContextBuilder } from "./contextBuilder";

describe("ContextBuilder", () => {
  it("keeps the fixed order, warns for static sections, and trims bounded sections oldest-first", async () => {
    const prompts: PromptSet = {
      "persona.md": `PERSONA ${"p".repeat(6_500)}`,
      "gedragsregels.md": "RULES",
      "demo-modi.md": "MODES",
      "sessiebrief.md": `BRIEF ${"b".repeat(2_600)}`,
    };
    const loader = { loadFresh: async () => prompts } as unknown as PromptLoader;
    const summaries = Array.from({ length: 12 }, (_, index) => ({
      id: `s${index}`,
      block: String(index),
      summary: `summary-${index} ${"s".repeat(700)}`,
      createdAt: new Date().toISOString(),
      coversUntil: index,
    }));
    const transcript = Array.from({ length: 24 }, (_, index) => ({
      id: `t${index}`,
      source: "room" as const,
      text: `literal-${index} ${"t".repeat(700)}`,
      tsStart: index,
      tsEnd: index + 1,
    }));
    const notes = Array.from({ length: 30 }, (_, index) => ({
      id: `n${index}`,
      tekst: `note-${index} ${"n".repeat(300)}`,
      type: (index % 2 ? "inzicht" : "vraag") as "inzicht" | "vraag",
      block: "2-verdieping",
      timestamp: new Date().toISOString(),
    }));
    const result = await new ContextBuilder(loader, {
      summaries: { list: async () => summaries },
      transcript: { recent: async () => transcript },
      notes: { list: async () => notes },
    }).build();

    const headings = [
      "# Persona, gedragsregels en demo-modi",
      "# Sessiebrief",
      "# Bloksamenvattingen",
      "# Recent letterlijk transcript",
      "# Oogstnotities",
    ];
    expect(headings.map((heading) => result.instructions.indexOf(heading))).toEqual(
      [...headings].map((_, index) => expect.any(Number)),
    );
    for (let index = 1; index < headings.length; index += 1) {
      expect(result.instructions.indexOf(headings[index])).toBeGreaterThan(result.instructions.indexOf(headings[index - 1]));
    }
    expect(result.warnings).toHaveLength(2);
    expect(result.instructions).not.toContain("summary-0 ");
    expect(result.instructions).toContain("summary-11 ");
    expect(result.instructions).not.toContain("literal-0 ");
    expect(result.instructions).toContain("literal-23 ");
    expect(result.instructions).toContain("Totaal: 30");
    expect(result.instructions).not.toContain("note-0 ");
    expect(result.instructions).toContain("note-29 ");

    for (const section of result.sections.filter((item) => !["static", "sessionBrief"].includes(item.id))) {
      expect(section.tokens).toBeLessThanOrEqual(CONTEXT_BUDGETS[section.id]);
      expect(section.truncated).toBe(true);
    }
  });
});
