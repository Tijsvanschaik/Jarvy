import path from "node:path";
import { z } from "zod";
import { atomicWriteJson, readJsonFile } from "./persistence";

const persistedConfigSchema = z.object({
  currentBlock: z.string().min(1).default("1-welkom"),
});

export class ConfigStore {
  private current = persistedConfigSchema.parse({});
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  static inDataDir(dataDir: string): ConfigStore {
    return new ConfigStore(path.join(dataDir, "config.json"));
  }

  async load(): Promise<void> {
    const value = await readJsonFile(this.filePath);
    this.current = persistedConfigSchema.parse(value ?? {});
  }

  get currentBlock(): string {
    return this.current.currentBlock;
  }

  async setBlock(block: string): Promise<void> {
    const next = persistedConfigSchema.parse({ currentBlock: block });
    const write = this.writeQueue.then(() => atomicWriteJson(this.filePath, next));
    this.writeQueue = write.catch(() => undefined);
    await write;
    this.current = next;
  }
}
