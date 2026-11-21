import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { TeamRun } from "./types.js";

export class TeamRunStore {
  constructor(private readonly directory = path.resolve("data/agents/runs")) {}

  private file(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("ID de ejecución inválido.");
    return path.join(this.directory, id + ".json");
  }

  createId(): string {
    return randomUUID();
  }

  async save(run: TeamRun): Promise<void> {
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

  async get(id: string): Promise<TeamRun | undefined> {
    try {
      const raw = await readFile(this.file(id), "utf8");
      const run = JSON.parse(raw) as TeamRun;
      if (!run.id || run.id !== id || !Array.isArray(run.agents) || !run.taskId) {
        throw new Error("El registro de ejecución está incompleto.");
      }
      return run;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async updateDecision(id: string, decision: "accepted" | "rejected"): Promise<TeamRun> {
    const run = await this.get(id);
    if (!run) throw new Error("No se encontró la ejecución " + id + ".");
    if (run.status === "running") throw new Error("No puedes revisar una ejecución todavía activa.");
    run.decision = decision;
    run.decisionAt = new Date().toISOString();
    await this.save(run);
    return run;
  }
}
