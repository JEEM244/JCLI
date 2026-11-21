import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FilePatch } from "./types.js";

export class PatchStore {
  constructor(private readonly directory = path.resolve("data/patches")) {}

  private recordsDirectory(): string {
    return path.join(this.directory, "records");
  }

  private backupsDirectory(): string {
    return path.join(this.directory, "backups");
  }

  private recordFile(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("ID de propuesta inválido.");
    return path.join(this.recordsDirectory(), id + ".json");
  }

  private backupFile(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("ID de respaldo inválido.");
    return path.join(this.backupsDirectory(), id + ".bak");
  }

  async save(patch: FilePatch): Promise<void> {
    const directory = this.recordsDirectory();
    await mkdir(directory, { recursive: true });
    const target = this.recordFile(patch.id);
    const temporary = target + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temporary, JSON.stringify(patch, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx"
      });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async get(id: string): Promise<FilePatch | undefined> {
    try {
      const content = await readFile(this.recordFile(id), "utf8");
      const patch = JSON.parse(content) as FilePatch;
      if (patch.id !== id || !patch.projectId || !patch.targetPath ||
          !patch.originalHash || !patch.proposedHash || !patch.status) {
        throw new Error("El registro de la propuesta está incompleto.");
      }
      return patch;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async list(limit = 20): Promise<FilePatch[]> {
    await mkdir(this.recordsDirectory(), { recursive: true });
    const names = (await readdir(this.recordsDirectory()))
      .filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name))
      .sort();
    const items: FilePatch[] = [];
    for (const name of names.slice(-Math.max(1, Math.min(100, limit)))) {
      const item = await this.get(name.slice(0, -5));
      if (item) items.push(item);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveBackup(id: string, content: string): Promise<string> {
    await mkdir(this.backupsDirectory(), { recursive: true });
    await writeFile(this.backupFile(id), content, { encoding: "utf8", flag: "wx" });
    return path.join("backups", id + ".bak");
  }

  async readBackup(id: string): Promise<string> {
    return readFile(this.backupFile(id), "utf8");
  }
}
