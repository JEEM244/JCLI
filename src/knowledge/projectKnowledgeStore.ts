import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectAnalysis } from "../projects/projectAnalyzer.js";
import type {
  ProjectKnowledge,
  ProjectKnowledgeDecision,
  ProjectKnowledgeNote,
  ProjectStructureSnapshot
} from "./types.js";

const MAX_NOTES = 100;
const MAX_DECISIONS = 100;

function storageName(projectId: string): string {
  if (!projectId || projectId.trim() !== projectId || projectId.length > 100 ||
      projectId === "." || projectId === ".." || /[\/\\]/.test(projectId) ||
      /[\0-\x1f\x7f]/.test(projectId)) {
    throw new Error("ID de proyecto no válido para la memoria.");
  }
  return createHash("sha256").update(projectId.toLowerCase(), "utf8").digest("hex") + ".json";
}

function redactSecrets(value: string): string {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[SECRETO OCULTO]")
    .replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{12,}\b/g, "[TOKEN OCULTO]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[TOKEN OCULTO]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[TOKEN OCULTO]")
    .replace(/(\b(?:api[_-]?key|client[_-]?secret|secret|password|passwd|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*)(["'])([^"']{4,})\2/gi, "$1$2[SECRETO OCULTO]$2")
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, "$1[TOKEN OCULTO]")
    .replace(/(^|\n)([A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|CLIENT_SECRET|PASSWORD|TOKEN)\s*=\s*)([^\r\n#]{4,})/gi, "$1$2[SECRETO OCULTO]");
}

function cleanText(input: string, label: string, maxLength: number): string {
  if (typeof input !== "string") throw new Error(label + " debe ser texto.");
  const trimmed = input.trim();
  if (!trimmed) throw new Error(label + " no puede estar vacío.");
  if (trimmed.length > maxLength) throw new Error(label + " no puede superar " + maxLength + " caracteres.");
  const safe = redactSecrets(trimmed.replace(/\u0000/g, ""));
  return safe.slice(0, maxLength);
}

function emptyKnowledge(projectId: string): ProjectKnowledge {
  return {
    projectId,
    updatedAt: "",
    notes: [],
    decisions: []
  };
}

export class ProjectKnowledgeStore {
  constructor(private readonly directory = path.resolve("data/knowledge/projects")) {}

  private file(projectId: string): string {
    return path.join(this.directory, storageName(projectId));
  }

  private async save(data: ProjectKnowledge): Promise<ProjectKnowledge> {
    await mkdir(this.directory, { recursive: true });
    const updated: ProjectKnowledge = { ...data, updatedAt: new Date().toISOString() };
    const target = this.file(data.projectId);
    const temporary = target + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temporary, JSON.stringify(updated, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx"
      });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return updated;
  }

  async get(projectId: string): Promise<ProjectKnowledge> {
    const file = this.file(projectId);
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as ProjectKnowledge;
      if (parsed.projectId !== projectId || !Array.isArray(parsed.notes) ||
          !Array.isArray(parsed.decisions) || typeof parsed.updatedAt !== "string") {
        throw new Error("El registro de memoria del proyecto está incompleto o no coincide.");
      }
      if (parsed.notes.length > MAX_NOTES || parsed.decisions.length > MAX_DECISIONS) {
        throw new Error("El registro de memoria supera los límites admitidos.");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyKnowledge(projectId);
      throw error;
    }
  }

  async setSummary(projectId: string, summary: string): Promise<ProjectKnowledge> {
    const data = await this.get(projectId);
    data.summary = cleanText(summary, "El resumen", 2000);
    return this.save(data);
  }

  async addNote(projectId: string, content: string): Promise<ProjectKnowledgeNote> {
    const data = await this.get(projectId);
    if (data.notes.length >= MAX_NOTES) throw new Error("Máximo de notas por proyecto: " + MAX_NOTES + ".");
    const note: ProjectKnowledgeNote = {
      id: randomUUID(),
      content: cleanText(content, "La nota", 1500),
      createdAt: new Date().toISOString()
    };
    data.notes.push(note);
    await this.save(data);
    return note;
  }

  async removeNote(projectId: string, noteId: string): Promise<ProjectKnowledgeNote> {
    const data = await this.get(projectId);
    const note = data.notes.find((item) => item.id === noteId);
    if (!note) throw new Error("No se encontró la nota " + noteId + ".");
    data.notes = data.notes.filter((item) => item.id !== noteId);
    await this.save(data);
    return note;
  }

  async addDecision(
    projectId: string,
    title: string,
    decision: string,
    context = ""
  ): Promise<ProjectKnowledgeDecision> {
    const data = await this.get(projectId);
    if (data.decisions.length >= MAX_DECISIONS) {
      throw new Error("Máximo de decisiones por proyecto: " + MAX_DECISIONS + ".");
    }
    const entry: ProjectKnowledgeDecision = {
      id: randomUUID(),
      title: cleanText(title, "El título de la decisión", 120),
      decision: cleanText(decision, "La decisión", 1200),
      ...(context.trim() ? { context: cleanText(context, "El contexto", 1200) } : {}),
      createdAt: new Date().toISOString()
    };
    data.decisions.push(entry);
    await this.save(data);
    return entry;
  }

  async removeDecision(projectId: string, decisionId: string): Promise<ProjectKnowledgeDecision> {
    const data = await this.get(projectId);
    const entry = data.decisions.find((item) => item.id === decisionId);
    if (!entry) throw new Error("No se encontró la decisión " + decisionId + ".");
    data.decisions = data.decisions.filter((item) => item.id !== decisionId);
    await this.save(data);
    return entry;
  }

  async saveStructure(projectId: string, analysis: ProjectAnalysis): Promise<ProjectStructureSnapshot> {
    const data = await this.get(projectId);
    const snapshot: ProjectStructureSnapshot = {
      generatedAt: new Date().toISOString(),
      filesScanned: Math.max(0, Math.min(2500, Math.trunc(analysis.filesScanned))),
      languages: analysis.languages.slice(0, 20).map((item) => ({
        name: cleanText(item.name, "Lenguaje", 60),
        files: Math.max(0, Math.trunc(item.files))
      })),
      technologies: analysis.technologies.slice(0, 30).map((item) => cleanText(item, "Tecnología", 80)),
      manifests: analysis.manifests.slice(0, 50).map((item) => cleanText(item, "Manifiesto", 120)),
      gitRepository: Boolean(analysis.gitRepository)
    };
    data.structure = snapshot;
    await this.save(data);
    return snapshot;
  }

  async getContext(projectId: string, maxCharacters = 4000): Promise<string> {
    const data = await this.get(projectId);
    const limit = Math.max(500, Math.min(8000, Math.trunc(maxCharacters) || 4000));
    const sections: string[] = [];
    const append = (label: string, value: string): void => {
      const candidate = (sections.length ? "\n\n" : "") + label + "\n" + value;
      const used = sections.join("").length;
      const remaining = limit - used;
      if (remaining <= 0) return;
      if (candidate.length <= remaining) sections.push(candidate);
      else if (remaining > label.length + 10) {
        const marker = "\n[Contexto de memoria recortado.]";
        const contentLength = Math.max(0, remaining - marker.length);
        sections.push(candidate.slice(0, contentLength) + marker);
      }
    };

    if (data.summary) append("RESUMEN DEL PROYECTO", data.summary);
    if (data.structure) {
      const structure = [
        "Archivos revisados: " + data.structure.filesScanned,
        "Lenguajes: " + (data.structure.languages.map((item) => item.name + " (" + item.files + ")").join(", ") || "sin detectar"),
        "Tecnologías: " + (data.structure.technologies.join(", ") || "sin detectar"),
        "Manifiestos: " + (data.structure.manifests.join(", ") || "ninguno"),
        "Repositorio Git: " + (data.structure.gitRepository ? "sí" : "no")
      ].join("\n");
      append("ESTRUCTURA DETECTADA (" + data.structure.generatedAt + ")", structure);
    }
    const decisions = data.decisions.slice(-10);
    if (decisions.length) {
      append("DECISIONES TÉCNICAS RECIENTES", decisions.map((item) =>
        "- " + item.title + ": " + item.decision +
        (item.context ? " (Contexto: " + item.context + ")" : "")
      ).join("\n"));
    }
    const notes = data.notes.slice(-10);
    if (notes.length) {
      append("NOTAS DEL PROYECTO", notes.map((item) => "- " + item.content).join("\n"));
    }
    return sections.join("");
  }
}
