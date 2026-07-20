import fs from "node:fs/promises";
import { z } from "zod";
import type { OogstNotitie } from "../shared/types";

const noteSchema: z.ZodType<OogstNotitie> = z.object({
  id: z.string(),
  text: z.string(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string(),
});

export class NotesStore {
  constructor(private readonly legacyDatabasePath: string) {}

  async list(): Promise<OogstNotitie[]> {
    try {
      const value = JSON.parse(await fs.readFile(this.legacyDatabasePath, "utf8")) as { notes?: unknown[] };
      return (value.notes ?? []).flatMap((note) => {
        const parsed = noteSchema.safeParse(note);
        return parsed.success ? [parsed.data] : [];
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
