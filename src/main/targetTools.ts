import { z } from "zod";
import { domeinSchema } from "../shared/schemas";
import type { AidenToolResult } from "../shared/types";
import type { BoardStore } from "./boardStore";
import type { NotesStore } from "./notesStore";
import type { SignalStore } from "./signalStore";
import { ToolHost, toolError, type ToolDefinition } from "./toolHost";

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const string = { type: "string" };

export type TargetToolDependencies = {
  signals: SignalStore;
  board: BoardStore;
  notes: NotesStore;
  generateImage: (args: { prompt: string; size?: string }, signal: AbortSignal) => Promise<AidenToolResult>;
  searchWeb: (args: { query: string; numResults?: number }, signal: AbortSignal) => Promise<AidenToolResult>;
  cameraVision?: {
    enabled: boolean;
    look: (frames: 1 | 2 | 3, signal: AbortSignal) => Promise<string>;
  };
  recap?: {
    enabled: boolean;
    start: () => { started: boolean; alreadyRunning?: true };
  };
  onBoardPin?: (state: ReturnType<BoardStore["snapshot"]>) => void;
  onNoteAdded?: (note: Awaited<ReturnType<NotesStore["append"]>>) => void;
};

export function createTargetToolHost(deps: TargetToolDependencies): ToolHost {
  const definitions: ToolDefinition[] = [
    {
      name: "zoek_signaal",
      args: z.object({ id: z.string().trim().min(1) }).strict(),
      parameters: objectSchema({ id: string }, ["id"]),
      description: () =>
        `Zoek eerst in de lokale gevalideerde signaalbibliotheek. Gebruik dit vóór zoek_web bij voorbeelden of signalen. Geldige complete index: ${JSON.stringify(deps.signals.compactIndex())}`,
      handler: async ({ id }) => {
        const signal = await deps.signals.find(id);
        return signal
          ? { ok: true, signaal: signal }
          : toolError("NOT_FOUND", `Onbekend signaal '${id}'.`, { validIndex: deps.signals.compactIndex() });
      },
    },
    {
      name: "toon_op_bord",
      args: z
        .object({
          signaalId: z.string().trim().min(1).optional(),
          beeldPad: z.string().trim().min(1).optional(),
          domein: domeinSchema,
          notitie: z.string().trim().min(1).optional(),
        })
        .strict()
        .refine((value) => Boolean(value.signaalId) !== Boolean(value.beeldPad), "Provide signaalId or beeldPad."),
      parameters: objectSchema(
        {
          signaalId: string,
          beeldPad: string,
          domein: { type: "string", enum: domeinSchema.options },
          notitie: string,
        },
        ["domein"],
      ),
      description: "Pin een bestaand signaal of lokaal beeldpad in de opgegeven domeinkolom van het persistente signaalbord.",
      handler: async (args) => {
        const pin = await deps.board.pin(args);
        const board = deps.board.snapshot();
        deps.onBoardPin?.(board);
        return {
          ok: true,
          pin,
          board,
          artifact: { title: "Signaalbord", kind: "signalBoard", content: JSON.stringify(board) },
        };
      },
    },
    {
      name: "maak_notitie",
      args: z
        .object({
          deelnemer: z.string().trim().min(1).optional(),
          type: z.enum(["inzicht", "aanname", "vraag", "vervolgstap", "dilemma"]),
          tekst: z.string().trim().min(1),
        })
        .strict(),
      parameters: objectSchema(
        {
          deelnemer: string,
          type: { type: "string", enum: ["inzicht", "aanname", "vraag", "vervolgstap", "dilemma"] },
          tekst: string,
        },
        ["type", "tekst"],
      ),
      description: "Sla een rustige oogstnotitie op in het huidige programmablok.",
      handler: async (args) => {
        const saved = await deps.notes.append(args);
        deps.onNoteAdded?.(saved);
        return { ok: true, saved, count: deps.notes.count };
      },
    },
    {
      name: "genereer_beeld",
      args: z
        .object({
          prompt: z.string().trim().min(1),
          size: z.enum(["1024x1024", "1024x1536", "1536x1024"]).optional(),
        })
        .strict(),
      parameters: objectSchema(
        { prompt: string, size: { type: "string", enum: ["1024x1024", "1024x1536", "1536x1024"] } },
        ["prompt"],
      ),
      description: "Genereer één beeld en toon het als artifact. Gebruik niet voor signalen die al in de lokale bibliotheek staan.",
      handler: (args, context) => deps.generateImage(args, context.signal),
    },
    {
      name: "zoek_web",
      args: z
        .object({ query: z.string().trim().min(1), numResults: z.number().int().min(1).max(10).optional() })
        .strict(),
      parameters: objectSchema(
        { query: string, numResults: { type: "integer", minimum: 1, maximum: 10 } },
        ["query"],
      ),
      description: "Zoek met Exa naar actuele externe bronnen. Gebruik zoek_signaal eerst bij voorbeeld- of signaalvragen.",
      handler: (args, context) => deps.searchWeb(args, context.signal),
    },
    {
      name: "kijk_mee",
      exposed: deps.cameraVision?.enabled === true,
      args: z
        .object({ frames: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() })
        .strict(),
      parameters: objectSchema({ frames: { type: "integer", enum: [1, 2, 3] } }),
      description:
        "Kijk uitsluitend op dit expliciete moment via de webcam; de camera gaat daarna direct uit. Gebruik in routine 4 voor een feitelijke observatie en verbind die in 1–2 zinnen met het transcript.",
      handler: async ({ frames = 1 }, context) => ({
        ok: true,
        beschrijving: await deps.cameraVision!.look(frames, context.signal),
      }),
    },
    {
      name: "start_recap",
      exposed: deps.recap?.enabled === true,
      args: z.object({}).strict(),
      parameters: objectSchema({}),
      description:
        "Start de asynchrone recap uitsluitend in routine 5, nadat Aiden heeft aangekondigd dat hij kort gaat nadenken. Wacht niet op het deck; voortgang en slides verschijnen vanzelf.",
      handler: () => ({ ok: true, ...deps.recap!.start() }),
    },
  ];
  return new ToolHost(definitions);
}
