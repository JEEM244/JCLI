import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { HistoryAction, HistoryEntry } from "../types.js";

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export class HistoryStore {
  constructor(private readonly filePath = path.resolve("data/history/events.jsonl")) {}

  async record(action: HistoryAction, entityId: string, summary: string): Promise<HistoryEntry> {
    const entry: HistoryEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      entityId,
      summary
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf8");
    return entry;
  }

  async list(limit = 20): Promise<HistoryEntry[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 20));
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    const entries = content.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        const value = JSON.parse(line) as HistoryEntry;
        if (!value.id || !value.timestamp || !value.action || !value.entityId || !value.summary) {
          throw new Error("faltan campos obligatorios");
        }
        return value;
      } catch (error) {
        throw new Error("Registro de historial inválido en la línea " + (index + 1) +
          ": " + (error instanceof Error ? error.message : "JSON incorrecto"));
      }
    });
    return entries.slice(-safeLimit).reverse();
  }
}
