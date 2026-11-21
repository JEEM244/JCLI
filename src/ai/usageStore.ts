import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AIUsageEntry } from "./types.js";

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export class AIUsageStore {
  constructor(private readonly filePath = path.resolve("data/history/ai-usage.jsonl")) {}

  async record(entry: AIUsageEntry): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf8");
  }

  async list(limit = 30): Promise<AIUsageEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    const entries = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        const entry = JSON.parse(line) as AIUsageEntry;
        if (!entry.timestamp || !entry.provider || !entry.model || !entry.result) {
          throw new Error("faltan campos obligatorios");
        }
        return entry;
      } catch (error) {
        throw new Error("Registro de consumo inválido en línea " + (index + 1) +
          ": " + (error instanceof Error ? error.message : "JSON incorrecto"));
      }
    });
    return entries.slice(-Math.max(1, Math.min(200, Math.trunc(limit) || 30))).reverse();
  }

  async countToday(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    return (await this.list(200)).filter((entry) =>
      entry.timestamp.slice(0, 10) === today
    ).length;
  }

  async totalsToday(): Promise<{ requests: number; inputTokens: number; outputTokens: number }> {
    const today = new Date().toISOString().slice(0, 10);
    const entries = (await this.list(200)).filter((entry) =>
      entry.timestamp.slice(0, 10) === today
    );
    return {
      requests: entries.length,
      inputTokens: entries.reduce((total, entry) => total + (entry.inputTokens ?? 0), 0),
      outputTokens: entries.reduce((total, entry) => total + (entry.outputTokens ?? 0), 0)
    };
  }
}
