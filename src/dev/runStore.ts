import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DevRun } from "./types.js";

export class DevRunStore {
  constructor(private readonly directory = path.resolve("data/dev-runs")) {}

  private file(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("ID de ejecución inválido.");
    return path.join(this.directory, id + ".json");
  }

  async save(run: DevRun): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.file(run.id);
    const temporary = target + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temporary, JSON.stringify(run, null, 2) + "\n", "utf8");
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async get(id: string): Promise<DevRun | undefined> {
    try {
      const raw = await readFile(this.file(id), "utf8");
      const run = JSON.parse(raw) as DevRun;
      if (run.id !== id || !run.projectId || !run.command || !run.status) {
        throw new Error("El registro de ejecución está incompleto.");
      }
      return run;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async list(limit = 20): Promise<DevRun[]> {
    await mkdir(this.directory, { recursive: true });
    const names = (await readdir(this.directory))
      .filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name))
      .sort();
    const items: DevRun[] = [];
    for (const name of names.slice(-Math.max(1, Math.min(100, limit)))) {
      const item = await this.get(name.slice(0, -5));
      if (item) items.push(item);
    }
    return items.reverse();
  }
}
