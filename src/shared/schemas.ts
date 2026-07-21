import { z } from "zod";

export const domeinSchema = z.enum(["zorg", "mobiliteit", "sociaal", "energie", "algemeen"]);

export const signaalSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Signaal id must be a lowercase slug."),
  titel: z.string().trim().min(1),
  laag: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  domein: domeinSchema,
  type: z.enum(["hard", "zacht"]),
  kernfeit: z.string().trim().min(1),
  bron: z.string().trim().min(1),
  jaar: z.string().trim().min(1),
  beleidsvraag: z.string().trim().min(1),
  uitlegKort: z.string().trim().min(1),
  afbeelding: z.string().trim().min(1).optional(),
});

export const signalLibrarySchema = z.array(signaalSchema);

export const oogstNotitieSchema = z.object({
  id: z.string().min(1),
  deelnemer: z.string().trim().min(1).optional(),
  type: z.enum(["inzicht", "aanname", "vraag", "vervolgstap", "dilemma"]),
  tekst: z.string().trim().min(1),
  block: z.string().trim().min(1),
  timestamp: z.string().datetime(),
});

export const boardPinSchema = z
  .object({
    id: z.string().min(1),
    signaalId: z.string().min(1).optional(),
    beeldPad: z.string().min(1).optional(),
    domein: domeinSchema,
    notitie: z.string().trim().min(1).optional(),
    pinnedAt: z.string().datetime(),
    signaal: signaalSchema.optional(),
  })
  .refine((pin) => Boolean(pin.signaalId) !== Boolean(pin.beeldPad), "Exactly one signal or image reference is required.");

export const boardStateSchema = z.object({ pins: z.array(boardPinSchema) });

export type SignaalInput = z.infer<typeof signaalSchema>;
export type OogstNotitieInput = z.infer<typeof oogstNotitieSchema>;
export type BoardPinInput = z.infer<typeof boardPinSchema>;
