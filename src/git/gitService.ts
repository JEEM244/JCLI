import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { HistoryStore } from "../history/historyStore.js";
import { ProjectStore } from "../projects/projectStore.js";
import type { GitCommit, GitCommandResult, GitStatus } from "./types.js";

const OUTPUT_LIMIT = 50000;
const COMMAND_TIMEOUT = 30000;
const MAX_PATHS = 20;
const BLOCKED_DIRECTORIES = new Set([
  ".git", ".hg", ".svn", "node_modules", ".vs", "bin", "obj", "dist",
  "build", "coverage", "vendor", ".next", ".nuxt", "target", "out",
  ".venv", "venv", ".ssh", ".aws", ".azure", ".gnupg"
]);

function appendLimited(current: string, chunk: string): string {
  if (current.length >= OUTPUT_LIMIT) return current;
  const next = current + chunk;
  if (next.length <= OUTPUT_LIMIT) return next;
  return next.slice(0, OUTPUT_LIMIT) + "\n[Salida recortada por el límite de JCLI.]";
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  const blocked = /^(?:GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_COMMON_DIR|GIT_CONFIG|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_NOSYSTEM|GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+|GIT_CEILING_DIRECTORIES|GIT_DISCOVERY_ACROSS_FILESYSTEM)$/i;
  for (const key of Object.keys(environment)) {
    if (blocked.test(key)) delete environment[key];
  }
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_PAGER = "cat";
  environment.PAGER = "cat";
  environment.GIT_OPTIONAL_LOCKS = "0";
  return environment;
}

function normalizeSafePath(input: string): string {
  const normalized = input.replace(/\\/g, "/");
  if (!normalized || normalized.trim() !== normalized || normalized.includes("\0") ||
      normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || path.win32.isAbsolute(input)) {
    throw new Error("Indica una ruta relativa al proyecto.");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("La ruta contiene segmentos no permitidos.");
  }
  if (parts.some((part) => BLOCKED_DIRECTORIES.has(part.toLowerCase()))) {
    throw new Error("No se permite operar dentro de carpetas de dependencias o generadas.");
  }
  for (const part of parts) {
    if (/^\.env(?:\.|$)/i.test(part) ||
        /^(?:\.npmrc|\.pypirc|\.netrc|credentials?(?:\..*)?|secrets?(?:\..*)?)$/i.test(part) ||
        /^id_(?:rsa|dsa|ed25519)$/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part)) {
      throw new Error("JCLI bloquea archivos que pueden contener credenciales o claves.");
    }
  }
  return parts.join("/");
}

function validateBranchName(name: string): void {
  if (!name || name.length > 100 || name.startsWith("-") ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) ||
      name.includes("..") || name.includes("//") ||
      name.endsWith("/") || name.endsWith(".") ||
      name.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))) {
    throw new Error("Nombre de rama inválido. Usa letras, números, puntos, guiones y /.");
  }
}

export class GitService {
  constructor(
    private readonly projects = new ProjectStore(),
    private readonly history = new HistoryStore()
  ) {}

  async inspect(projectId: string): Promise<GitStatus> {
    const project = await this.requireProject(projectId);
    await this.ensureRepository(project.directory);
    const result = await this.run(project.directory,
      ["status", "--short", "--branch", "--untracked-files=all"]);
    const lines = result.stdout.split(/\r?\n/).filter(Boolean);
    const header = lines.shift() ?? "";
    const branchMatch = header.match(/^## (.+)$/);
    const branch = branchMatch?.[1] ?? "desconocida";
    return {
      projectId: project.id,
      root: project.directory,
      branch,
      clean: lines.length === 0,
      changes: lines,
      summary: lines.length ? lines.length + " archivo(s) con cambios" : "sin cambios locales"
    };
  }

  async diff(projectId: string, staged = false, targetPath?: string): Promise<string> {
    const project = await this.requireProject(projectId);
    await this.ensureRepository(project.directory);
    const args = ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-color"];
    if (staged) args.push("--cached");
    args.push("--");
    if (targetPath) args.push(normalizeSafePath(targetPath));
    const result = await this.run(project.directory, args);
    return result.stdout || "No hay diferencias para mostrar.";
  }

  async stage(projectId: string, targetPaths: string[], confirmed: boolean): Promise<GitCommandResult> {
    if (!confirmed) throw new Error("Preparar archivos requiere --confirm.");
    const project = await this.requireProject(projectId);
    await this.ensureRepository(project.directory);
    const paths = await this.validateFilePaths(project.directory, targetPaths, true);
    const result = await this.run(project.directory, ["--literal-pathspecs", "add", "-A", "--", ...paths]);
    await this.history.record("git.staged", project.id, "Archivos preparados: " + paths.join(", "));
    return result;
  }

  async unstage(projectId: string, targetPaths: string[], confirmed: boolean): Promise<GitCommandResult> {
    if (!confirmed) throw new Error("Retirar archivos del área de preparación requiere --confirm.");
    const project = await this.requireProject(projectId);
    await this.ensureRepository(project.directory);
    const paths = await this.validateFilePaths(project.directory, targetPaths, true);
    const result = await this.run(project.directory,
      ["--literal-pathspecs", "restore", "--staged", "--", ...paths]);
    await this.history.record("git.unstaged", project.id, "Archivos retirados del área de preparación: " + paths.join(", "));
    return result;
  }

  async commit(projectId: string, message: string, confirmed: boolean): Promise<GitCommit> {
    if (!confirmed) throw new Error("Crear un commit requiere --confirm.");
    if (!message || message.trim() !== message || message.length > 120 ||
        /[\r\n\0]/.test(message)) {
      throw new Error("El mensaje debe tener entre 1 y 120 caracteres y ocupar una sola línea.");
    }
    const project = await this.requireProject(projectId);
    await this.ensureRepository(project.directory);
    const staged = await this.run(project.directory, ["diff", "--cached", "--quiet"], [0, 1]);
    if (staged.exitCode === 0) throw new Error("No hay cambios preparados. Usa troc git stage antes del commit.");
    await this.run(project.directory, ["commit", "-m", message]);
    const commit = await this.latestCommit(project.directory);
    await this.history.record("git.committed", commit.hash,
      "Commit creado en " + project.id + ": " + commit.subject);
    return commit;
  }

  async log(projectId: string, limit = 10): Promise<GitCommit[]> {
    const project = await this.requireProject(projectId);
    await this.ensureRepository(project.directory);
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 10));
    const result = await this.run(project.directory, [
      "log", "-n", String(safeLimit), "--format=%H%x09%s%x09%an%x09%aI"
    ]);
    return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hash = "", subject = "", author = "", date = ""] = line.split("\t");
      return { hash, subject, author, date };
    });
  }

  async listBranches(projectId: string): Promise<string[]> {
    const project = await this.requireProject(projectId);
    await this.ensureRepository(project.directory);
    const result = await this.run(project.directory, ["branch", "--format=%(refname:short)"]);
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  async createBranch(projectId: string, branchName: string, confirmed: boolean): Promise<string> {
    if (!confirmed) throw new Error("Crear una rama requiere --confirm.");
    validateBranchName(branchName);
    const project = await this.requireProject(projectId);
    await this.ensureRepository(project.directory);
    await this.run(project.directory, ["check-ref-format", "--branch", branchName]);
    await this.run(project.directory, ["switch", "-c", branchName]);
    await this.history.record("git.branch_created", project.id, "Rama creada y activada: " + branchName);
    return branchName;
  }

  async switchBranch(projectId: string, branchName: string, confirmed: boolean): Promise<string> {
    if (!confirmed) throw new Error("Cambiar de rama requiere --confirm.");
    validateBranchName(branchName);
    const project = await this.requireProject(projectId);
    await this.ensureRepository(project.directory);
    const branches = await this.listBranches(projectId);
    if (!branches.includes(branchName)) {
      throw new Error("La rama local no existe. Crea primero la rama o clona el repositorio correspondiente.");
    }
    await this.run(project.directory, ["switch", branchName]);
    await this.history.record("git.branch_switched", project.id, "Rama activada: " + branchName);
    return branchName;
  }

  private async latestCommit(directory: string): Promise<GitCommit> {
    const result = await this.run(directory,
      ["log", "-1", "--format=%H%x09%s%x09%an%x09%aI"]);
    const [hash = "", subject = "", author = "", date = ""] = result.stdout.trim().split("\t");
    if (!hash) throw new Error("Git no devolvió el commit recién creado.");
    return { hash, subject, author, date };
  }

  private async requireProject(projectId: string) {
    const project = await this.projects.get(projectId);
    if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
    return project;
  }

  private async ensureRepository(directory: string): Promise<void> {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("La carpeta registrada del proyecto no es un directorio local seguro.");
    }
    const resolvedProject = await realpath(directory);
    const result = await this.run(directory, ["rev-parse", "--show-toplevel"]);
    const resolvedRoot = await realpath(result.stdout.trim());
    const relative = path.relative(resolvedRoot, resolvedProject);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("La carpeta del proyecto queda fuera de la raíz del repositorio Git.");
    }
  }

  private async validateFilePaths(directory: string, inputPaths: string[], allowMissingTracked: boolean): Promise<string[]> {
    if (!inputPaths.length || inputPaths.length > MAX_PATHS) {
      throw new Error("Indica entre 1 y " + MAX_PATHS + " archivos por operación.");
    }
    const unique = [...new Set(inputPaths.map(normalizeSafePath))];
    for (const relative of unique) {
      const segments = relative.split("/");
      let current = directory;
      for (let index = 0; index < segments.length; index++) {
        current = path.join(current, segments[index]);
        try {
          const info = await lstat(current);
          if (info.isSymbolicLink()) throw new Error("No se permiten enlaces simbólicos en rutas Git.");
          if (index < segments.length - 1 && !info.isDirectory()) {
            throw new Error("Una parte de la ruta no es una carpeta: " + relative);
          }
          if (index === segments.length - 1 && !info.isFile()) {
            throw new Error("Solo se pueden preparar archivos individuales, no carpetas.");
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !allowMissingTracked || index !== segments.length - 1) {
            throw error;
          }
          await this.run(directory, ["--literal-pathspecs", "ls-files", "--error-unmatch", "--", relative]);
        }
      }
    }
    return unique;
  }

  private async run(
    directory: string,
    args: string[],
    acceptedExitCodes: number[] = [0]
  ): Promise<GitCommandResult> {
    const started = Date.now();
    const display = "git " + args.join(" ");
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn("git", args, {
        cwd: directory,
        shell: false,
        windowsHide: true,
        env: gitEnvironment(),
        stdio: ["ignore", "pipe", "pipe"]
      });
      const timer = setTimeout(() => {
        if (settled) return;
        child.kill();
        settled = true;
        reject(new Error("Git superó el límite de 30 segundos: " + display));
      }, COMMAND_TIMEOUT);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = appendLimited(stdout, chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = appendLimited(stderr, chunk.toString("utf8"));
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("No se pudo iniciar Git. Comprueba que Git esté instalado y en PATH: " + error.message));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const exitCode = code ?? -1;
        const result = {
          command: display,
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - started
        };
        if (!acceptedExitCodes.includes(exitCode)) {
          const detail = stderr.trim() || stdout.trim() || "Git terminó con código " + exitCode + ".";
          reject(new Error(detail.slice(0, 2000)));
          return;
        }
        resolve(result);
      });
    });
  }
}
