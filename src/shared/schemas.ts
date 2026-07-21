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

export const recapSlideSchema = z
  .object({
    id: z.string().trim().min(1),
    soort: z.enum(["blok", "deelnemer", "slot"]),
    titel: z.string().trim().min(1),
    bullets: z.array(z.string().trim().min(1)).min(1).max(8),
    beeldPrompt: z.string().trim().min(1).optional(),
    beeldPad: z.string().trim().min(1).optional(),
  })
  .strict();

export const recapDeckSchema = z
  .object({
    id: z.string().trim().min(1),
    slides: z.array(recapSlideSchema).min(1).max(40),
    createdAt: z.string().datetime(),
  })
  .strict();

export const recapCorePointsSchema = z
  .object({
    block: z.string().trim().min(1),
    kernpunten: z.array(z.string().trim().min(1)).max(12),
    onzekerheden: z.array(z.string().trim().min(1)).max(8),
  })
  .strict();

export const recapDeckJsonSchema = openAIStrictSchema(z.toJSONSchema(recapDeckSchema, { target: "draft-7" }));
export const recapCorePointsJsonSchema = openAIStrictSchema(
  z.toJSONSchema(recapCorePointsSchema, { target: "draft-7" }),
);

export type SignaalInput = z.infer<typeof signaalSchema>;
export type OogstNotitieInput = z.infer<typeof oogstNotitieSchema>;
export type BoardPinInput = z.infer<typeof boardPinSchema>;
export type RecapSlideInput = z.infer<typeof recapSlideSchema>;
export type RecapDeckInput = z.infer<typeof recapDeckSchema>;
export type RecapCorePointsInput = z.infer<typeof recapCorePointsSchema>;

function openAIStrictSchema(input: Record<string, unknown>): Record<string, unknown> {
  const schema = structuredClone(input);
  delete schema.$schema;
  makeObjectsStrict(schema);
  return schema;
}

function makeObjectsStrict(schema: Record<string, unknown>): void {
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : undefined;
  if (properties) {
    const originallyRequired = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const [name, property] of Object.entries(properties)) {
      makeObjectsStrict(property);
      if (!originallyRequired.has(name)) {
        const existingType = property.type;
        if (typeof existingType === "string") property.type = [existingType, "null"];
        else property.anyOf = [...(Array.isArray(property.anyOf) ? property.anyOf : [structuredClone(property)]), { type: "null" }];
      }
    }
    schema.required = Object.keys(properties);
    schema.additionalProperties = false;
  }
  if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    makeObjectsStrict(schema.items as Record<string, unknown>);
  }
}
