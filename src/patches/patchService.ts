import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { HistoryStore } from "../history/historyStore.js";
import { ProjectStore } from "../projects/projectStore.js";
import { PatchStore } from "./patchStore.js";
import type { FilePatch } from "./types.js";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_LINES = 1500;

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeRelativePath(input: string): string[] {
  const normalized = input.replace(/\\/g, "/");
  if (!normalized || normalized.trim() !== normalized || normalized.includes("\0") ||
      normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || path.win32.isAbsolute(input)) {
    throw new Error("La ruta debe ser relativa a la carpeta del proyecto.");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("La ruta contiene segmentos no permitidos.");
  }

  const blockedDirectories = new Set([
    ".git", ".hg", ".svn", "node_modules", ".vs", "bin", "obj",
    "dist", "build", "coverage", "vendor", ".next", ".nuxt",
    "target", "out", ".venv", "venv"
  ]);
  for (const part of parts) {
    if (blockedDirectories.has(part.toLowerCase())) {
      throw new Error("La ruta apunta a una carpeta protegida: " + part + ".");
    }
    if (/^\.env(?:\.|$)/i.test(part) ||
        /^(?:\.npmrc|\.pypirc|\.netrc|credentials?(?:\..*)?|secrets?(?:\..*)?)$/i.test(part) ||
        /^id_(?:rsa|dsa|ed25519)$/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part)) {
      throw new Error("JCLI bloquea archivos que pueden contener credenciales o claves: " + part + ".");
    }
  }
  return parts;
}

async function resolveSafeFile(projectDirectory: string, relativePath: string): Promise<string> {
  const parts = normalizeRelativePath(relativePath);
  const rootInfo = await lstat(projectDirectory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("La carpeta registrada del proyecto no es un directorio local seguro.");
  }
  const root = await realpath(projectDirectory);
  let current = root;

  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("JCLI no modifica rutas que atraviesen enlaces simbólicos.");
    if (index < parts.length - 1 && !info.isDirectory()) {
      throw new Error("Un segmento de la ruta no es una carpeta: " + parts[index] + ".");
    }
    if (index === parts.length - 1 && !info.isFile()) {
      throw new Error("El archivo debe existir y ser un archivo regular: " + relativePath + ".");
    }
  }

  const actual = await realpath(current);
  const relative = path.relative(root, actual);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("La ruta final queda fuera de la carpeta del proyecto.");
  }
  return actual;
}

async function readTextFile(filePath: string): Promise<{ content: string; mode: number }> {
  const info = await stat(filePath);
  if (!info.isFile() || info.size > MAX_FILE_BYTES) {
    throw new Error("JCLI solo admite archivos de texto de hasta 256 KiB.");
  }
  const bytes = await readFile(filePath);
  if (bytes.includes(0)) throw new Error("No se admiten archivos binarios.");
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes)) {
    throw new Error("El archivo debe contener texto UTF-8 válido.");
  }
  if (content.split(/\r?\n/).length > MAX_LINES) {
    throw new Error("El archivo supera el límite de 1,500 líneas para revisar cambios.");
  }
  return { content, mode: info.mode };
}

async function atomicReplace(filePath: string, content: string, expectedHash: string): Promise<void> {
  const current = await readTextFile(filePath);
  if (sha256(current.content) !== expectedHash) {
    throw new Error("El archivo cambió durante la operación. No se sobrescribió.");
  }
  const temporary = filePath + "." + randomUUID() + ".jcli-tmp";
  try {
    await writeFile(temporary, content, {
      encoding: "utf8",
      flag: "wx",
      mode: current.mode
    });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export class PatchService {
  constructor(
    private readonly projects = new ProjectStore(),
    private readonly patches = new PatchStore(),
    private readonly history = new HistoryStore()
  ) {}

  async draft(projectId: string, targetPath: string, candidatePath: string): Promise<FilePatch> {
    const project = await this.projects.get(projectId);
    if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");

    const targetFile = await resolveSafeFile(project.directory, targetPath);
    const candidateFile = await resolveSafeFile(project.directory, candidatePath);
    const [targetInfo, candidateInfo] = await Promise.all([stat(targetFile), stat(candidateFile)]);
    if (targetInfo.dev === candidateInfo.dev && targetInfo.ino !== 0 &&
        targetInfo.ino === candidateInfo.ino) {
      throw new Error("El archivo original y el candidato deben ser archivos distintos.");
    }

    const [original, proposed] = await Promise.all([
      readTextFile(targetFile),
      readTextFile(candidateFile)
    ]);
    if (original.content === proposed.content) {
      throw new Error("No hay cambios entre el archivo original y el candidato.");
    }

    const now = new Date().toISOString();
    const patch: FilePatch = {
      id: randomUUID(),
      projectId: project.id,
      targetPath: targetPath.replace(/\\/g, "/"),
      candidatePath: candidatePath.replace(/\\/g, "/"),
      originalHash: sha256(original.content),
      proposedHash: sha256(proposed.content),
      originalContent: original.content,
      proposedContent: proposed.content,
      status: "draft",
      createdAt: now,
      updatedAt: now
    };
    await this.patches.save(patch);
    await this.history.record("patch.drafted", patch.id,
      "Propuesta creada para " + patch.projectId + ": " + patch.targetPath);
    return patch;
  }

  async get(id: string): Promise<FilePatch | undefined> {
    return this.patches.get(id);
  }

  async list(limit = 20): Promise<FilePatch[]> {
    return this.patches.list(limit);
  }

  async approve(id: string): Promise<FilePatch> {
    const patch = await this.requirePatch(id);
    if (patch.status !== "draft") {
      throw new Error("Solo se pueden aprobar propuestas en estado draft.");
    }
    const updated: FilePatch = {
      ...patch,
      status: "approved",
      approvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.patches.save(updated);
    await this.history.record("patch.approved", id, "Propuesta aprobada: " + patch.targetPath);
    return updated;
  }

  async reject(id: string): Promise<FilePatch> {
    const patch = await this.requirePatch(id);
    if (patch.status !== "draft") {
      throw new Error("Solo se pueden rechazar propuestas en estado draft.");
    }
    const updated: FilePatch = {
      ...patch,
      status: "rejected",
      rejectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.patches.save(updated);
    await this.history.record("patch.rejected", id, "Propuesta rechazada: " + patch.targetPath);
    return updated;
  }

  async apply(id: string, confirmed: boolean): Promise<FilePatch> {
    if (!confirmed) throw new Error("La aplicación requiere --confirm.");
    const patch = await this.requirePatch(id);
    if (patch.status !== "approved") {
      throw new Error("La propuesta debe estar aprobada antes de aplicarse.");
    }
    if (sha256(patch.originalContent) !== patch.originalHash ||
        sha256(patch.proposedContent) !== patch.proposedHash) {
      throw new Error("El registro de la propuesta no coincide con sus hashes; se bloqueó la aplicación.");
    }

    const project = await this.projects.get(patch.projectId);
    if (!project) throw new Error("El proyecto ya no está registrado.");
    const targetFile = await resolveSafeFile(project.directory, patch.targetPath);
    const current = await readTextFile(targetFile);
    if (sha256(current.content) !== patch.originalHash) {
      throw new Error("El archivo cambió desde que se creó la propuesta. Crea una nueva propuesta para evitar sobrescribir cambios.");
    }

    const backupPath = await this.patches.saveBackup(id, patch.originalContent);
    await atomicReplace(targetFile, patch.proposedContent, patch.originalHash);
    const updated: FilePatch = {
      ...patch,
      status: "applied",
      backupPath,
      appliedHash: patch.proposedHash,
      appliedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.patches.save(updated);
    await this.history.record("patch.applied", id, "Propuesta aplicada a " + patch.targetPath);
    return updated;
  }

  async rollback(id: string, confirmed: boolean): Promise<FilePatch> {
    if (!confirmed) throw new Error("La reversión requiere --confirm.");
    const patch = await this.requirePatch(id);
    if (patch.status !== "applied" || !patch.appliedHash || !patch.backupPath) {
      throw new Error("Solo se pueden revertir propuestas aplicadas con respaldo disponible.");
    }
    const project = await this.projects.get(patch.projectId);
    if (!project) throw new Error("El proyecto ya no está registrado.");
    const targetFile = await resolveSafeFile(project.directory, patch.targetPath);
    const backup = await this.patches.readBackup(id);
    if (sha256(backup) !== patch.originalHash) {
      throw new Error("El respaldo no coincide con el hash original. Se bloqueó la reversión.");
    }
    const current = await readTextFile(targetFile);
    if (sha256(current.content) !== patch.appliedHash) {
      throw new Error("El archivo cambió después de aplicar la propuesta. JCLI no sobrescribirá esos cambios.");
    }

    await atomicReplace(targetFile, backup, patch.appliedHash);
    const updated: FilePatch = {
      ...patch,
      status: "rolled_back",
      rolledBackAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.patches.save(updated);
    await this.history.record("patch.rolled_back", id, "Respaldo restaurado para " + patch.targetPath);
    return updated;
  }

  private async requirePatch(id: string): Promise<FilePatch> {
    const patch = await this.patches.get(id);
    if (!patch) throw new Error("No se encontró la propuesta " + id + ".");
    return patch;
  }
}
