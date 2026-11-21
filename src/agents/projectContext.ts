import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { AgentLimits, ProjectFileContext } from "./types.js";

const blockedFolders = new Set([
  ".git", ".svn", ".hg", "node_modules", "vendor", "dist", "build",
  "coverage", ".next", ".angular", "bin", "obj", ".vs", ".ssh", ".aws", ".azure", ".kube"
]);

function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === ".env" || lower.startsWith(".env.") ||
    lower === ".npmrc" || lower === ".pypirc" || lower === ".netrc" || lower === ".htpasswd" ||
    lower === "id_rsa" || lower === "id_ed25519" || lower === "credentials.json" ||
    /^appsettings(\\..+)?\\.json$/.test(lower) || lower === "web.config" ||
    lower.endsWith(".pem") || lower.endsWith(".key") || lower.endsWith(".pfx") ||
    lower.endsWith(".p12") || lower.endsWith(".tfstate") ||
    lower.includes("secret") || lower.includes("credential");
}

function redactCredentialMaterial(source: string): string {
  return source
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/(\\b(?:api[_-]?key|client[_-]?secret|secret|password|access[_-]?token|refresh[_-]?token)\\b\\s*[:=]\\s*)(["'])([^"']{8,})\\2/gi, "$1$2[REDACTED]$2")
    .replace(/(\\bBearer\\s+)[A-Za-z0-9._~+\\/-]{12,}/gi, "$1[REDACTED]")
    .replace(/(^|\\n)([A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|CLIENT_SECRET|PASSWORD)\\s*=\\s*)([^\\r\\n#]{8,})/gi, "$1$2[REDACTED]");
}

export class ProjectContextLoader {
  constructor(private readonly limits: AgentLimits) {}

  async load(projectDirectory: string, requestedFiles: string[]): Promise<ProjectFileContext[]> {
    if (requestedFiles.length > this.limits.maxFilesPerRun) {
      throw new Error("Máximo de archivos por ejecución: " + this.limits.maxFilesPerRun + ".");
    }
    const root = await realpath(projectDirectory);
    const seen = new Set<string>();
    const files: ProjectFileContext[] = [];
    let totalCharacters = 0;

    for (const requested of requestedFiles) {
      const normalized = requested.trim();
      if (!normalized || path.isAbsolute(normalized)) {
        throw new Error("La ruta debe ser relativa al proyecto: " + requested);
      }
      const segments = normalized.split(/[\\/]+/).filter(Boolean);
      if (segments.some((segment) => blockedFolders.has(segment.toLowerCase()) || isSensitiveName(segment))) {
        throw new Error("La ruta apunta a una carpeta o archivo protegido: " + requested);
      }

      const candidate = path.resolve(root, normalized);
      const candidateRelative = path.relative(root, candidate);
      if (!candidateRelative || candidateRelative.startsWith("..") || path.isAbsolute(candidateRelative)) {
        throw new Error("La ruta seleccionada sale de la carpeta del proyecto: " + requested);
      }
      let actual: string;
      try {
        actual = await realpath(candidate);
      } catch {
        throw new Error("No se encontró el archivo seleccionado: " + requested);
      }
      const relative = path.relative(root, actual);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("La ruta seleccionada sale de la carpeta del proyecto: " + requested);
      }
      const actualSegments = relative.split(path.sep);
      if (actualSegments.some((segment) => blockedFolders.has(segment.toLowerCase()) || isSensitiveName(segment))) {
        throw new Error("La ruta resuelta apunta a contenido protegido: " + requested);
      }

      const identity = process.platform === "win32" ? actual.toLowerCase() : actual;
      if (seen.has(identity)) throw new Error("El archivo está seleccionado más de una vez: " + requested);
      seen.add(identity);

      const info = await stat(actual);
      if (!info.isFile()) throw new Error("La ruta seleccionada no es un archivo: " + requested);
      if (info.size > this.limits.maxFileBytes) {
        throw new Error("El archivo supera el límite de " + this.limits.maxFileBytes + " bytes: " + requested);
      }

      const rawContent = await readFile(actual, "utf8");
      if (rawContent.includes("\u0000")) throw new Error("No se permite enviar archivos binarios: " + requested);
      const content = redactCredentialMaterial(rawContent);
      totalCharacters += content.length;
      if (totalCharacters > this.limits.maxContextCharacters) {
        throw new Error("El contexto supera el límite de " + this.limits.maxContextCharacters + " caracteres.");
      }
      files.push({ path: relative.split(path.sep).join("/"), content });
    }
    return files;
  }
}
