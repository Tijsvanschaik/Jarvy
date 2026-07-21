import fs from "node:fs/promises";
import path from "node:path";

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const handle = await fs.open(temporary, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, filePath);
}

export async function readJsonFile(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readJsonFileRecovering(
  filePath: string,
  warn: (message: string) => void = () => undefined,
): Promise<unknown | undefined> {
  try {
    return await readJsonFile(filePath);
  } catch (error) {
    const quarantine = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      await fs.rename(filePath, quarantine);
      warn(`Corrupt runtime state quarantined as ${path.basename(quarantine)}.`);
    } catch {
      warn(`Corrupt runtime state at ${path.basename(filePath)} was preserved and skipped.`);
    }
    return undefined;
  }
}

export async function quarantineFile(filePath: string, warn: (message: string) => void): Promise<void> {
  const quarantine = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    await fs.rename(filePath, quarantine);
    warn(`Corrupt runtime state quarantined as ${path.basename(quarantine)}.`);
  } catch {
    warn(`Corrupt runtime state at ${path.basename(filePath)} was preserved and skipped.`);
  }
}
