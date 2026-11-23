import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectVSCode, detectVisualStudio2026, detectVisualStudio2026Components, detectSSMS22 } from "../integrations/ide/detector.js";
import type { VisualStudioComponentRequirement, VisualStudioComponentStatus } from "../integrations/ide/detector.js";
import { executeDatabaseConnectionTest } from "./databaseConnectionTest.js";
const execFileAsync = promisify(execFile);

const IGNORED = new Set([".git", ".vs", ".idea", "node_modules", "vendor", "dist", "build", "coverage", "bin", "obj", ".venv", "venv", "__pycache__"]);
const MAX_FILES = 5000;
const MAX_DEPTH = 7;
const MAX_MANIFEST_SIZE = 384 * 1024;
const MAX_OUTPUT = 8000;
const TIMEOUT_MS = 180_000;

export interface SetupInspection {
  root: string; name: string; filesScanned: number; truncated: boolean;
  kinds: string[]; languages: string[]; manifests: string[];
  packageManagerHints: Record<string, string>;
  packageLockfiles: Record<string, string[]>;
  yarnBerryDirectories: string[];
  solutions: string[]; dotnetProjects: string[]; sqlProjects: string[];
  databaseEngines: string[]; databaseLibraries: string[];
  connectionFiles: string[]; connectionNames: string[];
  sqlScripts: string[]; migrations: string[]; backups: string[];
  packageDirectories: string[]; composerDirectories: string[];
  pythonDirectories: string[]; pythonRequirementsFiles: string[];
  pythonHashLockedRequirements: string[]; pythonEnvironments: string[];
  requirements: string[]; warnings: string[];
}
export interface SetupAction {
  id: string; title: string; description: string; executable: string;
  args: string[]; cwd: string; command: string; canRun: boolean;
}
export interface SetupPlan {
  inspection: SetupInspection; actions: SetupAction[]; manualSteps: string[];
}
export interface SetupVerificationItem {
  id: string; title: string; status: "ready" | "missing" | "manual" | "unsafe";
  target: string; details: string;
}

export interface SetupRunResult {
  actionId: string; title: string; status: "success" | "failed" | "timeout";
  exitCode: number | null; durationMs: number; stdout: string; stderr: string;
}
type Runner = (executable: string, args: string[], cwd: string) =>
  Promise<Omit<SetupRunResult, "actionId" | "title">>;

const rel = (root: string, file: string): string => path.relative(root, file).split(path.sep).join("/");

export function isHashLockedPythonRequirements(content: string): boolean {
  const lines = content.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (!lines.length) return false;
  const requirement = /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?==[A-Za-z0-9][A-Za-z0-9.+_-]*(?:\s+--hash=sha256:[a-f0-9]{64})+$/i;
  return lines.every((line) => requirement.test(line));
}

async function readManifest(file: string): Promise<string> {
  try {
    const info = await stat(file);
    return info.isFile() && info.size <= MAX_MANIFEST_SIZE ? await readFile(file, "utf8") : "";
  } catch { return ""; }
}
function collectConnectionNames(value: unknown, names: Set<string>): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === "connectionstrings" && child && typeof child === "object" && !Array.isArray(child)) {
      for (const name of Object.keys(child as Record<string, unknown>)) names.add(name);
    } else collectConnectionNames(child, names);
  }
}

export async function inspectProjectForSetup(input: string): Promise<SetupInspection> {
  if (!input.trim()) throw new Error("Indica la ruta de la carpeta del proyecto.");
  let root: string;
  try { root = await realpath(path.resolve(input)); }
  catch { throw new Error("No se pudo acceder a la ruta indicada."); }
  if (!(await stat(root)).isDirectory()) throw new Error("La ruta indicada no es una carpeta.");

  const files: string[] = [];
  const pythonEnvironments: string[] = [];
  let truncated = false;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) { truncated = true; return; }
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) { truncated = true; break; }
      if (entry.isDirectory()) {
        if ([".venv", "venv"].includes(entry.name.toLowerCase())) {
          pythonEnvironments.push(rel(root, path.join(dir, entry.name)));
        } else if (!IGNORED.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) files.push(path.join(dir, entry.name));
    }
  }
  await walk(root, 0);

  const paths = files.map((file) => rel(root, file));
  const lower = paths.map((file) => file.toLowerCase());
  const packageLockfiles: Record<string, string[]> = {};
  const has = (file: string): boolean => lower.includes(file.toLowerCase());
  for (const file of paths) {
    const base = path.posix.basename(file).toLowerCase();
    if (["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"].includes(base)) {
      const directory = path.posix.dirname(file);
      (packageLockfiles[directory] ??= []).push(file);
    }
  }
  const named = (pattern: RegExp): string[] => paths.filter((file) => pattern.test(path.posix.basename(file)));
  const solutions = named(/\.(sln|slnx)$/i).sort();
  const dotnetProjects = named(/\.csproj$/i).sort();
  const sqlProjects = named(/\.sqlproj$/i).sort();
  const sqlScripts = named(/\.sql$/i).sort();
  const backups = named(/\.(bak|bacpac)$/i).sort();
  const migrations = paths.filter((file) => /(^|\/)migrations?(\/|$)/i.test(file)).sort();

  const manifests: string[] = [];
  const connectionFiles: string[] = [];
  const connectionNames = new Set<string>();
  const kinds = new Set<string>();
  const languages = new Set<string>();
  const engines = new Set<string>();
  const libraries = new Set<string>();
  const requirements = new Set<string>();
  const packageDirectories: string[] = [];
  const composerDirectories: string[] = [];
  const packageManagerHints: Record<string, string> = {};
  const yarnBerryDirectories = new Set<string>();
  const pythonDirectories = new Set<string>();
  const pythonRequirementsFiles: string[] = [];
  const pythonHashLockedRequirements: string[] = [];
  const manifestNames = new Set([
    "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock",
    "composer.json", "composer.lock", "requirements.txt", "pyproject.toml", "pipfile",
    "cargo.toml", "cargo.lock", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts",
    "global.json", "directory.build.props", "angular.json", "schema.prisma", "go.sum"
  ]);
  const extensions: Record<string, string> = {
    ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
    ".php": "PHP", ".py": "Python", ".cs": "C#", ".java": "Java", ".kt": "Kotlin",
    ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".sql": "SQL", ".go": "Go", ".rs": "Rust"
  };

  for (const file of paths) {
    const base = path.posix.basename(file).toLowerCase();
    if (manifestNames.has(base) || /\.(sln|slnx|csproj|sqlproj)$/i.test(base) ||
        /^appsettings(\.[^/]+)?\.json$/i.test(base)) manifests.push(file);
    const language = extensions[path.posix.extname(file).toLowerCase()];
    if (language) languages.add(language);
    const absolute = path.join(root, file);

    if (base === "yarn.lock") {
      const lockContent = await readManifest(absolute);
      if (/^__metadata:\s*$/m.test(lockContent)) yarnBerryDirectories.add(path.posix.dirname(file));
    }

    if (/^appsettings(\.[^/]+)?\.json$/i.test(base)) {
      connectionFiles.push(file);
      try { collectConnectionNames(JSON.parse(await readManifest(absolute)) as unknown, connectionNames); }
      catch { /* El contenido de configuración no se muestra. */ }
    }
    if (base === "package.json") {
      const dir = path.posix.dirname(file);
      packageDirectories.push(dir);
      kinds.add("Node.js"); requirements.add("Node.js y npm");
      try {
        const parsed = JSON.parse(await readManifest(absolute)) as {
          dependencies?: Record<string,string>;
          devDependencies?: Record<string,string>;
          packageManager?: string;
        };
        if (parsed.packageManager) {
          const declared = parsed.packageManager.match(/^(npm|pnpm|yarn)@([0-9]+)(?:[.]|$)/i);
          packageManagerHints[dir] = declared
            ? declared[1].toLowerCase() + "@" + declared[2]
            : "unsupported";
        }
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        if (deps["@angular/core"] || has(path.posix.join(dir, "angular.json"))) kinds.add("Angular");
        if (deps.react) kinds.add("React");
        if (deps.vue) kinds.add("Vue");
        if (deps.express) kinds.add("Express");
        if (deps.mysql || deps.mysql2) { engines.add("MySQL"); libraries.add("mysql/mysql2"); }
        if (deps.pg) { engines.add("PostgreSQL"); libraries.add("pg"); }
        if (deps.mssql) { engines.add("SQL Server"); libraries.add("mssql"); }
        if (deps.sqlite3 || deps["better-sqlite3"]) engines.add("SQLite");
        if (deps.prisma || deps["@prisma/client"]) libraries.add("Prisma");
      } catch { /* Manifiesto inválido: se conserva como hallazgo. */ }
    }
    if (base === "composer.json") {
      composerDirectories.push(path.posix.dirname(file));
      kinds.add("PHP / Composer"); requirements.add("PHP y Composer");
      const content = await readManifest(absolute);
      if (/laravel\/framework/i.test(content)) kinds.add("Laravel");
      if (/symfony\/framework-bundle/i.test(content)) kinds.add("Symfony");
      if (/doctrine\/(dbal|orm)/i.test(content)) libraries.add("Doctrine");
      if (/ext-pdo_mysql|ext-mysqli/i.test(content)) engines.add("MySQL");
    }
    if (base === "schema.prisma") {
      const provider = (await readManifest(absolute)).match(/provider\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      const db: Record<string,string> = { sqlserver:"SQL Server", mysql:"MySQL", postgresql:"PostgreSQL", sqlite:"SQLite", mongodb:"MongoDB" };
      if (provider && db[provider]) engines.add(db[provider]);
      libraries.add("Prisma");
    }
    if (["requirements.txt", "pyproject.toml", "pipfile"].includes(base)) {
      kinds.add("Python"); requirements.add("Python");
      const directory = path.posix.dirname(file);
      pythonDirectories.add(directory);
      const content = await readManifest(absolute);
      if (base === "requirements.txt") {
        pythonRequirementsFiles.push(file);
        if (isHashLockedPythonRequirements(content)) pythonHashLockedRequirements.push(file);
      }
      if (/sqlalchemy|pymysql|mysqlclient/i.test(content)) libraries.add("SQLAlchemy / MySQL");
      if (/psycopg/i.test(content)) { engines.add("PostgreSQL"); libraries.add("psycopg"); }
      if (/pyodbc|pymssql/i.test(content)) { engines.add("SQL Server"); libraries.add("pyodbc / pymssql"); }
    }
    if (base === "go.mod") { kinds.add("Go"); requirements.add("Go"); }
    if (base === "cargo.toml") { kinds.add("Rust"); requirements.add("Rust y Cargo"); }
    if (["pom.xml", "build.gradle", "build.gradle.kts"].includes(base)) {
      kinds.add("Java"); requirements.add("JDK y gestor de compilación Java");
    }
  }

  for (const project of dotnetProjects) {
    kinds.add("C# / .NET"); requirements.add(".NET SDK");
    const content = await readManifest(path.join(root, project));
    if (/Microsoft\.NET\.Sdk\.Web/i.test(content)) kinds.add("ASP.NET Core");
    const classicWeb = /System\.Web(?:\.|,|")|Microsoft\.WebApplication\.targets|<ProjectTypeGuids>[^<]*349c5851-65df-11da-9384-00065b846f21/i.test(content);
    if (classicWeb) {
      kinds.add("ASP.NET Framework");
      const frameworkVersion = content.match(/<TargetFrameworkVersion>\s*v?([\d.]+)\s*<\/TargetFrameworkVersion>/i)?.[1];
      if (frameworkVersion === "4.8" || frameworkVersion === "4.8.1") {
        kinds.add(".NET Framework " + frameworkVersion);
      }
    }
    if (/Microsoft\.EntityFrameworkCore\.SqlServer|Microsoft\.Data\.SqlClient|System\.Data\.SqlClient/i.test(content)) {
      engines.add("SQL Server"); libraries.add("Entity Framework Core / SqlClient");
    }
    if (/Pomelo\.EntityFrameworkCore\.MySql|MySqlConnector/i.test(content)) {
      engines.add("MySQL"); libraries.add("Entity Framework Core / MySqlConnector");
    }
    if (/Npgsql|EntityFrameworkCore\.PostgreSQL/i.test(content)) {
      engines.add("PostgreSQL"); libraries.add("Npgsql");
    }
    if (/EntityFrameworkCore\.Sqlite/i.test(content)) {
      engines.add("SQLite"); libraries.add("Entity Framework Core SQLite");
    }
  }
  for (const project of sqlProjects) {
    const content = await readManifest(path.join(root, project));
    const sdkStyle = /Microsoft\.Build\.Sql|<Project\s+Sdk\s*=|<Sdk\b[^>]*Name\s*=\s*["']Microsoft\.Build\.Sql/i.test(content);
    kinds.add(sdkStyle ? "SQL Database Project SDK" : "SQL Database Project (SSDT clásico)");
  }
  if (solutions.length || dotnetProjects.length || sqlProjects.length) {
    kinds.add(".NET / Visual Studio"); requirements.add("Visual Studio 2026 o un editor compatible");
  }
  if (sqlProjects.length) { kinds.add("SQL Database Project"); requirements.add("SQL Server Data Tools o SDK de proyectos SQL compatible"); }
  if (paths.some((file) => /(^|\/)angular\.json$/i.test(file))) kinds.add("Angular");

  const warnings: string[] = [];
  for (const [directory, lockfiles] of Object.entries(packageLockfiles)) {
    if (lockfiles.length > 1) warnings.push("Node.js (" + directory + "): existen varios lockfiles; JCLI no elegirá un gestor automáticamente.");
  }
  if (truncated) warnings.push("Se alcanzó el límite de profundidad o archivos; el inventario puede estar incompleto.");
  if (connectionFiles.length) warnings.push("Se detectaron configuraciones de conexión. Solo se muestran nombres, nunca valores ni contraseñas.");
  if (engines.size && !migrations.length && !sqlScripts.length && !backups.length) warnings.push("Se detectó una base de datos, pero no se encontraron scripts, migraciones ni respaldos.");
  if (sqlScripts.length) warnings.push("Los scripts SQL se detectan, pero no se ejecutan desde Project Setup.");
  if (backups.length) warnings.push("Los respaldos no se restauran automáticamente.");
  if (solutions.length > 1) warnings.push("Hay varias soluciones; la restauración automática de .NET se desactiva.");
  if (!solutions.length && dotnetProjects.length > 1) warnings.push("Hay varios proyectos .csproj sin solución; la restauración automática de .NET se desactiva.");

  return {
    root, name: path.basename(root), filesScanned: files.length, truncated,
    kinds: [...kinds].sort(), languages: [...languages].sort(),
    manifests: [...new Set(manifests)].sort(),
    packageManagerHints,
    packageLockfiles: Object.fromEntries(Object.entries(packageLockfiles).map(([directory, files]) => [directory, files.sort()])),
    yarnBerryDirectories: [...yarnBerryDirectories].sort(),
    solutions, dotnetProjects, sqlProjects,
    databaseEngines: [...engines].sort(), databaseLibraries: [...libraries].sort(),
    connectionFiles: connectionFiles.sort(), connectionNames: [...connectionNames].sort(),
    sqlScripts, migrations, backups,
    packageDirectories: [...new Set(packageDirectories)].sort(),
    composerDirectories: [...new Set(composerDirectories)].sort(),
    pythonDirectories: [...pythonDirectories].sort(),
    pythonRequirementsFiles: [...new Set(pythonRequirementsFiles)].sort(),
    pythonHashLockedRequirements: [...new Set(pythonHashLockedRequirements)].sort(),
    pythonEnvironments: [...new Set(pythonEnvironments)].sort(),
    requirements: [...requirements].sort(), warnings
  };
}

function makeAction(id: string, title: string, description: string, executable: string,
  args: string[], cwd: string, command: string): SetupAction {
  return { id, title, description, executable, args, cwd, command, canRun: true };
}

export function createSetupPlan(report: SetupInspection): SetupPlan {
  const actions: SetupAction[] = [];
  const manualSteps: string[] = [];
  const target = report.solutions.length === 1 ? report.solutions[0]
    : report.solutions.length === 0 && report.dotnetProjects.length === 1 ? report.dotnetProjects[0] : undefined;

  if (target && report.dotnetProjects.length > 0 && report.sqlProjects.length === 0) {
    actions.push(makeAction("dotnet-restore", "Restaurar paquetes de .NET",
      "Descarga paquetes declarados; no compila ni ejecuta la aplicación.",
      "dotnet", ["restore", target], report.root, "dotnet restore " + target));
  }
  for (const dir of report.packageDirectories) {
    const lockfiles = report.packageLockfiles[dir] ?? [];
    const declared = report.packageManagerHints[dir];
    if (lockfiles.length !== 1) {
      manualSteps.push("Node.js (" + dir + "): " +
        (lockfiles.length ? "hay varios lockfiles y no se elegirá un gestor automáticamente." : "no se encontró un lockfile compatible."));
      continue;
    }
    const lockName = path.posix.basename(lockfiles[0]).toLowerCase();
    const lockManager = lockName === "package-lock.json" || lockName === "npm-shrinkwrap.json" ? "npm"
      : lockName === "pnpm-lock.yaml" ? "pnpm" : "yarn";
    const declaredManager = declared?.split("@")[0];
    if (declared === "unsupported") {
      manualSteps.push("Node.js (" + dir + "): packageManager declara un gestor no compatible; no se ejecutará una instalación automática.");
      continue;
    }
    if (declaredManager && declaredManager !== lockManager) {
      manualSteps.push("Node.js (" + dir + "): packageManager y el lockfile no coinciden; revisa el manifiesto antes de instalar.");
      continue;
    }
    let args: string[];
    let display: string;
    if (lockManager === "npm") {
      args = ["ci", "--ignore-scripts"];
      display = "npm ci --ignore-scripts";
    } else if (lockManager === "pnpm") {
      args = ["install", "--frozen-lockfile", "--ignore-scripts"];
      display = "pnpm install --frozen-lockfile --ignore-scripts";
    } else if (declared?.startsWith("yarn@") && Number(declared.split("@")[1]) >= 2 ||
      report.yarnBerryDirectories.includes(dir)) {
      args = ["install", "--immutable", "--mode=skip-builds"];
      display = "yarn install --immutable --mode=skip-builds";
    } else {
      args = ["install", "--frozen-lockfile", "--ignore-scripts"];
      display = "yarn install --frozen-lockfile --ignore-scripts";
    }
    const executable = process.platform === "win32" ? lockManager + ".cmd" : lockManager;
    actions.push(makeAction(lockManager + "-install-" + actions.length,
      "Restaurar dependencias de " + lockManager,
      "Usa el único lockfile detectado y evita ejecutar scripts o builds de dependencias.",
      executable, args, path.join(report.root, dir === "." ? "" : dir), display));
  }
  for (const dir of report.composerDirectories) {
    const lock = (dir === "." ? "" : dir + "/") + "composer.lock";
    if (report.manifests.some((file) => file.toLowerCase() === lock.toLowerCase())) {
      actions.push(makeAction("composer-install-" + actions.length, "Restaurar dependencias de Composer",
        "Usa composer.lock y desactiva plugins y scripts de terceros.",
        process.platform === "win32" ? "composer.bat" : "composer",
        ["install","--no-interaction","--no-scripts","--no-plugins"],
        path.join(report.root, dir === "." ? "" : dir),
        "composer install --no-interaction --no-scripts --no-plugins"));
    } else manualSteps.push("Composer: no hay composer.lock en " + dir + "; revisa las versiones antes de instalar.");
  }
  for (const directory of report.pythonDirectories) {
    const requirementFiles = report.pythonRequirementsFiles.filter((file) =>
      path.posix.dirname(file) === directory);
    const hashLockedFiles = report.pythonHashLockedRequirements.filter((file) =>
      path.posix.dirname(file) === directory);
    const existingEnvironment = report.pythonEnvironments.find((folder) =>
      path.posix.dirname(folder) === directory);
    const environmentRelative = existingEnvironment ??
      path.posix.join(directory === "." ? "" : directory, ".venv");
    const environmentAbsolute = path.join(report.root, environmentRelative);
    if (!existingEnvironment) {
      const venvExecutable = process.platform === "win32" ? "python.exe" : "python3";
      const venvArgs = ["-m", "venv", environmentRelative];
      actions.push(makeAction("python-venv-" + actions.length,
        "Crear entorno virtual de Python",
        "Crea un entorno aislado sin instalar paquetes ni ejecutar código del proyecto.",
        venvExecutable, venvArgs, report.root,
        venvExecutable + " -m venv " + environmentRelative));
    }
    if (hashLockedFiles.length) {
      const pythonExecutable = process.platform === "win32"
        ? path.join(environmentAbsolute, "Scripts", "python.exe")
        : path.join(environmentAbsolute, "bin", "python");
      for (const file of hashLockedFiles) {
        actions.push(makeAction("python-install-" + actions.length,
          "Instalar requisitos Python verificados",
          "Solo acepta versiones exactas con hashes SHA-256 y paquetes wheel; evita compilar paquetes desde código fuente.",
          pythonExecutable,
          ["-m", "pip", "install", "--require-hashes", "--only-binary=:all:", "-r", file],
          report.root,
          pythonExecutable + " -m pip install --require-hashes --only-binary=:all: -r " + file));
      }
    } else if (requirementFiles.length) {
      manualSteps.push("Python (" + directory + "): requirements.txt no está fijado completamente por versión y hashes; revisa e instala manualmente.");
    } else {
      manualSteps.push("Python (" + directory + "): revisar pyproject.toml/Pipfile y elegir un gestor antes de instalar.");
    }
  }
  for (const moduleFile of report.manifests.filter((file) => path.posix.basename(file).toLowerCase() === "go.mod")) {
    const directory = path.posix.dirname(moduleFile);
    const sumFile = path.posix.join(directory === "." ? "" : directory, "go.sum");
    if (report.manifests.some((file) => file.toLowerCase() === sumFile.toLowerCase())) {
      actions.push(makeAction("go-download-" + actions.length, "Descargar módulos Go",
        "Usa go.mod y go.sum para descargar dependencias; no compila ni ejecuta el proyecto.",
        "go", ["mod", "download"], path.join(report.root, directory === "." ? "" : directory),
        "go mod download"));
    } else {
      manualSteps.push("Go (" + directory + "): falta go.sum; revisa y genera el lockfile antes de descargar módulos.");
    }
  }
  for (const manifest of report.manifests.filter((file) => path.posix.basename(file).toLowerCase() === "cargo.toml")) {
    const directory = path.posix.dirname(manifest);
    const lockFile = path.posix.join(directory === "." ? "" : directory, "Cargo.lock");
    if (report.manifests.some((file) => file.toLowerCase() === lockFile.toLowerCase())) {
      actions.push(makeAction("cargo-fetch-" + actions.length, "Descargar crates de Rust",
        "Usa Cargo.lock y --locked; descarga dependencias sin compilar ni ejecutar build scripts.",
        "cargo", ["fetch", "--locked", "--manifest-path", manifest],
        path.join(report.root, directory === "." ? "" : directory),
        "cargo fetch --locked --manifest-path " + manifest));
    } else {
      manualSteps.push("Rust (" + directory + "): falta Cargo.lock; revisa y genera el lockfile antes de descargar crates.");
    }
  }
  if (report.databaseEngines.length) {
    manualSteps.push("Base de datos (" + report.databaseEngines.join(", ") + "): comprobar motor, instancia, permisos y conexión local.");
    manualSteps.push("JCLI no creará, migrará, sobrescribirá ni restaurará bases de datos automáticamente.");
  }
  if (report.solutions.length) manualSteps.push("Visual Studio 2026: abrir y revisar " + report.solutions.join(", ") + ".");
  else if (report.dotnetProjects.length) manualSteps.push("Visual Studio 2026: abrir " + report.dotnetProjects.join(", ") + ".");
  if (report.sqlProjects.length || report.sqlScripts.length) manualSteps.push("SSMS 22: revisar scripts SQL manualmente; JCLI no ejecutará instrucciones SQL.");
  if (report.packageDirectories.length && !actions.some((item) => /^(npm|pnpm|yarn)-/.test(item.id))) {
    manualSteps.push("Node.js: no se encontró un lockfile npm/pnpm/yarn compatible.");
  }
  if (!actions.length && !manualSteps.length) manualSteps.push("No hay acciones automáticas compatibles; revisa el inventario y configura manualmente.");
  return { inspection: report, actions, manualSteps };
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/(token|secret|password|passwd|credential|api[_-]?key|authorization)/i.test(key)) env[key] = value;
  }
  return env;
}
async function runCommand(executable: string, args: string[], cwd: string):
Promise<Omit<SetupRunResult, "actionId" | "title">> {
  const started = Date.now();
  return await new Promise((resolve) => {
    let stdout = "", stderr = "", timedOut = false, settled = false;
    const finish = (code: number | null, error?: string): void => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) stderr = (stderr + "\n" + error).slice(-MAX_OUTPUT);
      resolve({ status: timedOut ? "timeout" : code === 0 ? "success" : "failed",
        exitCode: code, durationMs: Date.now() - started,
        stdout: stdout.slice(-MAX_OUTPUT), stderr: stderr.slice(-MAX_OUTPUT) });
    };
    const child = spawn(executable, args, {
      cwd, env: safeEnvironment(),
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(executable),
      windowsHide: true, stdio: ["ignore","pipe","pipe"]
    });
    child.stdout?.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-MAX_OUTPUT); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-MAX_OUTPUT); });
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code));
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, TIMEOUT_MS);
  });
}
export async function executeSetupPlan(plan: SetupPlan, confirmed: boolean, runner: Runner = runCommand): Promise<SetupRunResult[]> {
  if (!confirmed) throw new Error("La preparación requiere confirmación explícita.");
  const runnable = plan.actions.filter((item) => item.canRun);
  if (!runnable.length) throw new Error("El plan no contiene acciones automáticas compatibles.");
  const results: SetupRunResult[] = [];
  for (const item of runnable) {
    const result = { actionId:item.id, title:item.title, ...(await runner(item.executable,item.args,item.cwd)) };
    results.push(result);
    if (result.status !== "success") break;
  }
  return results;
}


export interface ToolRequirement { id:string; name:string; commands:string[]; required:boolean; versionArgs?:string[]; note:string; }
export interface ToolCheck { id:string; name:string; required:boolean; installed:boolean; executable?:string; version?:string; note:string; }
export interface DatabaseServiceCheck { engine:string; serviceName?:string; state:"running"|"stopped"|"missing"|"unknown"; details:string; }
export interface SetupDoctorReport {
  inspection:SetupInspection; tools:ToolCheck[];
  ides:Array<{name:string;installed:boolean;executable?:string;details:string}>;
  databaseServices:DatabaseServiceCheck[]; missingRequired:string[];
  visualStudioComponents:VisualStudioComponentStatus[];
}

export function buildToolRequirements(report:SetupInspection,platform=process.platform):ToolRequirement[] {
  const items=new Map<string,ToolRequirement>();
  const add=(item:ToolRequirement):void=>{items.set(item.id,item);};
  if(report.packageDirectories.length){
    add({id:"node",name:"Node.js",commands:["node.exe","node"],required:true,versionArgs:["--version"],note:"Necesario para proyectos Node.js y Angular."});
    const locks=report.manifests.map(file=>path.posix.basename(file).toLowerCase());
    if(locks.includes("pnpm-lock.yaml")) add({id:"pnpm",name:"pnpm",commands:["pnpm.cmd","pnpm"],required:true,versionArgs:["--version"],note:"Gestor declarado por pnpm-lock.yaml."});
    else if(locks.includes("yarn.lock")) add({id:"yarn",name:"Yarn",commands:["yarn.cmd","yarn"],required:true,versionArgs:["--version"],note:"Gestor declarado por yarn.lock."});
    else add({id:"npm",name:"npm",commands:["npm.cmd","npm"],required:true,versionArgs:["--version"],note:"Gestor predeterminado para package.json."});
  }
  if(report.dotnetProjects.length) add({id:"dotnet",name:".NET SDK",commands:["dotnet.exe","dotnet"],required:true,versionArgs:["--version"],note:"Necesario para proyectos .NET."});
  if(report.composerDirectories.length){
    add({id:"php",name:"PHP",commands:["php.exe","php"],required:true,versionArgs:["--version"],note:"Necesario para proyectos PHP."});
    add({id:"composer",name:"Composer",commands:["composer.bat","composer"],required:true,note:"Necesario para dependencias PHP."});
  }
  if(report.requirements.includes("Python")) add({id:"python",name:"Python",commands:platform==="win32"?["py.exe","python.exe","py","python"]:["python3","python"],required:true,versionArgs:["--version"],note:"Necesario para proyectos Python."});
  if(report.kinds.includes("Go")) add({id:"go",name:"Go",commands:["go.exe","go"],required:true,versionArgs:["version"],note:"Necesario para módulos Go."});
  if(report.kinds.includes("Rust")){
    add({id:"cargo",name:"Cargo",commands:["cargo.exe","cargo"],required:true,versionArgs:["--version"],note:"Gestor Rust."});
    add({id:"rustc",name:"rustc",commands:["rustc.exe","rustc"],required:true,versionArgs:["--version"],note:"Compilador Rust."});
  }
  if(report.kinds.includes("Java")){
    add({id:"java",name:"Java",commands:["java.exe","java"],required:true,versionArgs:["--version"],note:"Entorno de ejecución Java."});
    add({id:"javac",name:"JDK / javac",commands:["javac.exe","javac"],required:true,versionArgs:["--version"],note:"Compilador del JDK."});
  }
  if(report.databaseEngines.includes("SQL Server")){
    add({id:"sqlcmd",name:"sqlcmd",commands:["sqlcmd.exe","sqlcmd"],required:false,note:"Cliente opcional de SQL Server."});
    add({id:"sqlpackage",name:"SqlPackage",commands:["sqlpackage.exe","sqlpackage"],required:false,note:"Herramienta opcional para paquetes DAC."});
  }
  if(report.databaseEngines.includes("MySQL")) add({id:"mysql-client",name:"Cliente MySQL",commands:["mysql.exe","mysql"],required:false,note:"Cliente opcional de MySQL."});
  if(report.databaseEngines.includes("PostgreSQL")) add({id:"psql",name:"psql",commands:["psql.exe","psql"],required:false,note:"Cliente opcional de PostgreSQL."});
  if(report.databaseEngines.includes("SQLite")) add({id:"sqlite3",name:"sqlite3",commands:["sqlite3.exe","sqlite3"],required:false,note:"Cliente opcional de SQLite."});
  return [...items.values()];
}

async function locateCommand(commands:string[]):Promise<string|undefined>{
  const resolver=process.platform==="win32"?"where.exe":"which";
  for(const command of commands){
    try{
      const result=await execFileAsync(resolver,[command],{windowsHide:true,timeout:5000,maxBuffer:256*1024});
      const found=String(result.stdout).split(/\r?\n/).map(line=>line.trim()).find(Boolean);
      if(found)return found;
    }catch{/* intenta el siguiente nombre */}
  }
  return undefined;
}
async function readToolVersion(executable:string,args:string[]):Promise<string|undefined>{
  if(/\.(cmd|bat)$/i.test(executable))return undefined;
  try{
    const result=await execFileAsync(executable,args,{windowsHide:true,timeout:5000,maxBuffer:256*1024});
    return (String(result.stdout)+"\n"+String(result.stderr)).split(/\r?\n/).map(line=>line.trim()).find(Boolean)?.slice(0,160);
  }catch{return undefined;}
}
async function checkRequirement(item:ToolRequirement):Promise<ToolCheck>{
  const executable=await locateCommand(item.commands);
  if(!executable)return {id:item.id,name:item.name,required:item.required,installed:false,note:item.note};
  const version=item.versionArgs?await readToolVersion(executable,item.versionArgs):undefined;
  return {id:item.id,name:item.name,required:item.required,installed:true,executable,...(version?{version}:{}),note:item.note};
}

export function parseWindowsDatabaseServices(output:string,engines:string[]):DatabaseServiceCheck[]{
  const patterns=[
    {engine:"SQL Server",pattern:/^(?:MSSQLSERVER|MSSQL\$.+)$/i},
    {engine:"MySQL",pattern:/^(?:MySQL\d*|MariaDB.*)$/i},
    {engine:"PostgreSQL",pattern:/^postgresql.*$/i}
  ];
  const found:Array<{engine:string;name:string;state:"running"|"stopped"|"unknown"}>=[];
  for(const block of output.split(/(?=^\s*SERVICE_NAME\s*:)/im)){
    const name=block.match(/^\s*SERVICE_NAME\s*:\s*(.+?)\s*$/im)?.[1]?.trim();
    if(!name)continue;
    const kind=patterns.find(item=>item.pattern.test(name));
    if(!kind||!engines.includes(kind.engine))continue;
    const stateText=block.match(/^\s*STATE\s*:\s*\d+\s+([A-Z_]+)/im)?.[1]?.toUpperCase();
    found.push({engine:kind.engine,name,state:stateText==="RUNNING"?"running":stateText==="STOPPED"?"stopped":"unknown"});
  }
  return engines.filter(engine=>patterns.some(item=>item.engine===engine)).map(engine=>{
    const matches=found.filter(item=>item.engine===engine);
    if(!matches.length)return {engine,state:"missing" as const,details:"No se encontró un servicio local; el servidor también podría ser remoto."};
    const running=matches.filter(item=>item.state==="running");
    return {engine,serviceName:running[0]?.name??matches[0].name,
      state:running.length?"running":matches.every(item=>item.state==="stopped")?"stopped":"unknown",
      details:matches.map(item=>item.name+" ("+item.state+")").join(", ")};
  });
}
async function inspectDatabaseServices(engines:string[]):Promise<DatabaseServiceCheck[]>{
  const supported=engines.filter(engine=>["SQL Server","MySQL","PostgreSQL"].includes(engine));
  if(!supported.length)return [];
  if(process.platform!=="win32")return supported.map(engine=>({engine,state:"unknown" as const,details:"La consulta de servicios locales usa el administrador de servicios de Windows."}));
  try{
    const result=await execFileAsync("sc.exe",["query","type=","service","state=","all"],{windowsHide:true,timeout:12000,maxBuffer:4*1024*1024});
    return parseWindowsDatabaseServices(String(result.stdout),supported);
  }catch{
    return supported.map(engine=>({engine,state:"unknown" as const,details:"No fue posible consultar servicios locales; comprueba su estado manualmente."}));
  }
}

export function buildVisualStudioComponentRequirements(
  report: Pick<SetupInspection, "kinds">
): VisualStudioComponentRequirement[] {
  const requirements: VisualStudioComponentRequirement[] = [];
  if (report.kinds.includes("ASP.NET Core") || report.kinds.includes("ASP.NET Framework")) {
    requirements.push({
      id: "Microsoft.VisualStudio.ComponentGroup.WebToolsExtensions",
      name: "ASP.NET y desarrollo web"
    });
  }
  if (report.kinds.includes(".NET Framework 4.8")) {
    requirements.push({
      id: "Microsoft.Net.Component.4.8.TargetingPack",
      name: ".NET Framework 4.8 targeting pack"
    });
  }
  if (report.kinds.includes(".NET Framework 4.8.1")) {
    requirements.push({
      id: "Microsoft.Net.Component.4.8.1.TargetingPack",
      name: ".NET Framework 4.8.1 targeting pack"
    });
  }
  if (report.kinds.includes("SQL Database Project (SSDT clásico)")) {
    requirements.push({
      id: "Microsoft.VisualStudio.Component.SQL.SSDT",
      name: "SQL Server Data Tools (SSDT)"
    });
  }
  return requirements;
}

export async function exportVisualStudioConfiguration(
  report: SetupInspection,
  generatedAt = new Date()
): Promise<string> {
  const requirements = buildVisualStudioComponentRequirements(report);
  if (!requirements.length) {
    throw new Error("El proyecto no requiere componentes adicionales de Visual Studio 2026 detectables.");
  }
  const root = await realpath(report.root);
  const directory = path.join(root, ".troc", "configs");
  await mkdir(directory, { recursive: true });
  const actualDirectory = await realpath(directory);
  const relativeDirectory = path.relative(root, actualDirectory);
  if (!relativeDirectory || path.isAbsolute(relativeDirectory) ||
      relativeDirectory === ".." || relativeDirectory.startsWith(".." + path.sep)) {
    throw new Error("La carpeta de configuración debe permanecer dentro del proyecto.");
  }

  const configuration = {
    version: "1.0",
    components: requirements.map((item) => item.id).sort()
  };
  const serialized = JSON.stringify(configuration, null, 2) + "\n";
  const timestamp = generatedAt.toISOString().replace(/[:.]/g, "-");
  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = attempt === 0 ? "" : "-" + attempt;
    const destination = path.join(actualDirectory, "visual-studio-2026-" + timestamp + suffix + ".vsconfig");
    try {
      await writeFile(destination, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new Error("No se pudo guardar el archivo de configuración de Visual Studio.");
      }
    }
  }
  throw new Error("No se pudo crear un nombre único para .vsconfig; no se sobrescribieron archivos.");
}


export async function inspectProjectEnvironment(report:SetupInspection):Promise<SetupDoctorReport>{
  const tools=await Promise.all(buildToolRequirements(report).map(checkRequirement));
  const ides:SetupDoctorReport["ides"]=[];
  if(report.solutions.length||report.dotnetProjects.length){
    const ide=await detectVisualStudio2026();
    ides.push({name:ide.name,installed:ide.installed,...(ide.executable?{executable:ide.executable}:{}),details:ide.details});
  }
  const visualStudioComponents = report.solutions.length || report.dotnetProjects.length || report.kinds.includes("SQL Database Project (SSDT clásico)")
    ? await detectVisualStudio2026Components(buildVisualStudioComponentRequirements(report))
    : [];
  if(report.packageDirectories.length||report.kinds.some(kind=>["PHP / Composer","Python","Go","Rust"].includes(kind))){
    const ide=await detectVSCode();
    ides.push({name:ide.name,installed:ide.installed,...(ide.executable?{executable:ide.executable}:{}),details:ide.details});
  }
  if(report.databaseEngines.includes("SQL Server")||report.sqlProjects.length||report.sqlScripts.length){
    const ide=await detectSSMS22();
    ides.push({name:ide.name,installed:ide.installed,...(ide.executable?{executable:ide.executable}:{}),details:ide.details});
  }
  const databaseServices=await inspectDatabaseServices(report.databaseEngines);
  return {inspection:report,tools,ides,databaseServices,visualStudioComponents,missingRequired:tools.filter(item=>item.required&&!item.installed).map(item=>item.name)};
}
function printDoctor(report:SetupDoctorReport):void{
  console.log("JCLI Project Setup — diagnóstico del entorno");
  console.log("Proyecto: "+report.inspection.name+"\nHerramientas:");
  if(!report.tools.length)console.log("  No hay toolchains que comprobar.");
  for(const item of report.tools){
    console.log("  ["+(item.installed?"DISPONIBLE":item.required?"FALTA":"NO DETECTADO (opcional)")+"] "+item.name+(item.required?" — requerido":" — opcional"));
    if(item.version)console.log("    Versión: "+item.version);
    if(item.executable)console.log("    Ruta: "+item.executable);
    console.log("    "+item.note);
  }
  if(report.ides.length){
    console.log("\nEditores:");
    for(const ide of report.ides){
      console.log("  ["+(ide.installed?"DISPONIBLE":"NO DETECTADO")+"] "+ide.name);
      if(ide.executable)console.log("    "+ide.executable);
      console.log("    "+ide.details);
    }
  }
  if(report.visualStudioComponents.length){
    console.log("\nComponentes de Visual Studio 2026:");
    for(const item of report.visualStudioComponents){
      const state = item.status === "installed" ? "DISPONIBLE" : item.status === "missing" ? "FALTA" : "NO SE PUDO COMPROBAR";
      console.log("  ["+state+"] "+item.name);
      console.log("    "+item.details);
    }
    console.log("JCLI solo diagnostica componentes; no abre el instalador ni modifica Visual Studio.");
  }
  if(report.databaseServices.length){
    console.log("\nServicios de bases de datos:");
    for(const service of report.databaseServices){
      console.log("  ["+service.state.toUpperCase()+"] "+service.engine+(service.serviceName?" — "+service.serviceName:""));
      console.log("    "+service.details);
    }
  }
  console.log("\nResultado: "+(report.missingRequired.length?"faltan herramientas requeridas: "+report.missingRequired.join(", "):"no faltan herramientas requeridas detectables."));
  if(report.inspection.databaseEngines.length){
    console.log("Un servicio activo no demuestra que una base concreta exista o acepte conexiones.");
    console.log("No se leyeron contraseñas, no se abrió conexión y no se ejecutó SQL.");
  }
  if (report.visualStudioComponents.some((item) => item.status === "missing")) {
    console.log('Para preparar la selección de componentes: troc setup vsconfig "' + report.inspection.root + '" --confirm');
  }
}


export interface DatabaseConnectionProfile {
  file:string; name:string; serverConfigured:boolean; portConfigured:boolean; databaseConfigured:boolean;
  authentication:"integrated"|"credentials"|"conflicting"|"unspecified"; environmentVariables:string[];
}
export function inspectConnectionString(name:string,file:string,value:string):DatabaseConnectionProfile {
  const fields=new Map<string,string>();
  const pattern=/(?:^|;)\s*([^=;]+)\s*=\s*(?:"((?:[^"]|"")*)"|'((?:[^']|'')*)'|([^;]*))/g;
  for(const match of value.matchAll(pattern)){
    const key=match[1].trim().toLowerCase().replace(/[\s_]/g,"");
    fields.set(key,(match[2]??match[3]??match[4]??"").trim());
  }
  const server=["server","datasource","address","addr","networkaddress","host","hostname"]
    .some((key)=>Boolean(fields.get(key)));
  const port=["port","serverport"].some((key)=>Boolean(fields.get(key)));
  const database=["database","initialcatalog","dbname","catalog"]
    .some((key)=>Boolean(fields.get(key)));
  const integrated=["integratedsecurity","trustedconnection"]
    .some(key=>["true","yes","sspi"].includes((fields.get(key)??"").toLowerCase()));
  const credentials=["userid","uid","user","username"].some(key=>Boolean(fields.get(key)));
  const authentication=integrated&&credentials?"conflicting"
    :integrated?"integrated":credentials?"credentials":"unspecified";
  const references=new Set<string>();
  for(const item of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$\(([A-Za-z_][A-Za-z0-9_]*)\)|%([A-Za-z_][A-Za-z0-9_]*)%/g))
    references.add(item[1]??item[2]??item[3]);
  return {file,name,serverConfigured:server,portConfigured:port,databaseConfigured:database,
    authentication,environmentVariables:[...references].sort()};
}
function collectConnectionProfiles(value:unknown,file:string,profiles:DatabaseConnectionProfile[]):void{
  if(!value||typeof value!=="object"||Array.isArray(value))return;
  for(const [key,child] of Object.entries(value as Record<string,unknown>)){
    if(key.toLowerCase()==="connectionstrings"&&child&&typeof child==="object"&&!Array.isArray(child)){
      for(const [name,connection] of Object.entries(child as Record<string,unknown>)){
        if(typeof connection==="string"&&/(?:server|data\s*source|host|hostname|port|database|initial\s*catalog|dbname)\s*=/i.test(connection))
          profiles.push(inspectConnectionString(name,file,connection));
      }
    }else collectConnectionProfiles(child,file,profiles);
  }
}
export async function inspectDatabaseConfiguration(report:SetupInspection):Promise<DatabaseConnectionProfile[]>{
  const profiles:DatabaseConnectionProfile[]=[];
  for(const file of report.connectionFiles){
    const absolute=path.resolve(report.root,file);
    const relative=path.relative(report.root,absolute);
    if(relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative))continue;
    try{const content=await readManifest(absolute);if(content)collectConnectionProfiles(JSON.parse(content) as unknown,file,profiles);}
    catch{/* Configuración inválida: se omite sin mostrar su contenido. */}
  }
  return profiles.sort((a,b)=>a.file.localeCompare(b.file)||a.name.localeCompare(b.name));
}
function printDatabaseConfiguration(profiles:DatabaseConnectionProfile[]):void{
  console.log("JCLI Project Setup — configuración de conexiones");
  if(!profiles.length){console.log("No se encontraron cadenas de conexión en archivos appsettings*.json.");return;}
  for(const profile of profiles){
    console.log("\n"+profile.name+" ("+profile.file+")");
    console.log("  Servidor/host: "+(profile.serverConfigured?"configurado":"falta"));
    console.log("  Puerto: "+(profile.portConfigured?"configurado":"no indicado"));
    console.log("  Base de datos: "+(profile.databaseConfigured?"configurada":"falta"));
    const authentication=profile.authentication==="integrated"?"Windows / integrada"
      :profile.authentication==="credentials"?"credenciales configuradas (valores ocultos)"
      :profile.authentication==="conflicting"?"configuración mixta; revisar autenticación"
      :"no identificada";
    console.log("  Autenticación: "+authentication);
    console.log("  Variables de entorno referenciadas: "+(profile.environmentVariables.join(", ")||"ninguna detectada"));
  }
  console.log("\nPor seguridad no se muestran hosts, puertos, nombres de bases, usuarios ni contraseñas.");
  console.log("Este análisis no resuelve variables de entorno ni intenta conectarse al servidor.");
}



async function inspectLocalArtifact(
  root: string,
  relativePath: string,
  expected: "file" | "directory"
): Promise<"present" | "missing" | "unsafe"> {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) return "unsafe";
  let current = root;
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) return "unsafe";
      const isLast = index === segments.length - 1;
      if (!isLast && !info.isDirectory()) return "missing";
      if (isLast) {
        return expected === "directory"
          ? (info.isDirectory() ? "present" : "missing")
          : (info.isFile() ? "present" : "missing");
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return "missing";
      return "unsafe";
    }
  }
  return "missing";
}

export async function verifySetupArtifacts(
  inspection: SetupInspection,
  platform: NodeJS.Platform = process.platform
): Promise<SetupVerificationItem[]> {
  const root = await realpath(inspection.root);
  const items: SetupVerificationItem[] = [];
  const add = async (
    id: string, title: string, target: string, expected: "file" | "directory",
    readyDetails: string, missingDetails: string
  ): Promise<void> => {
    const state = await inspectLocalArtifact(root, target, expected);
    items.push({
      id, title, target,
      status: state === "present" ? "ready" : state === "unsafe" ? "unsafe" : "missing",
      details: state === "present" ? readyDetails
        : state === "unsafe" ? "El destino contiene un enlace simbólico o una ruta no verificable; no se siguió."
        : missingDetails
    });
  };

  for (const directory of inspection.packageDirectories) {
    const target = path.posix.join(directory === "." ? "" : directory, "node_modules");
    await add("node:" + directory, "Dependencias Node.js", target, "directory",
      "La carpeta node_modules existe.", "No existe node_modules; revisa el lockfile y ejecuta la restauración confirmada.");
  }
  for (const directory of inspection.composerDirectories) {
    const target = path.posix.join(directory === "." ? "" : directory, "vendor");
    await add("composer:" + directory, "Dependencias Composer", target, "directory",
      "La carpeta vendor existe.", "No existe vendor; revisa composer.lock y ejecuta la restauración confirmada.");
  }
  for (const directory of inspection.pythonDirectories) {
    const environment = inspection.pythonEnvironments.find((folder) =>
      path.posix.dirname(folder) === directory);
    if (!environment) {
      items.push({
        id: "python:" + directory, title: "Entorno virtual Python",
        status: "missing", target: path.posix.join(directory === "." ? "" : directory, ".venv"),
        details: "No se detectó .venv ni venv."
      });
      continue;
    }
    const interpreter = platform === "win32"
      ? path.posix.join(environment, "Scripts", "python.exe")
      : path.posix.join(environment, "bin", "python");
    await add("python:" + directory, "Entorno virtual Python", interpreter, "file",
      "Se encontró el intérprete del entorno virtual.", "Existe la carpeta del entorno, pero no se encontró su intérprete.");
  }
  for (const project of inspection.dotnetProjects) {
    const directory = path.posix.dirname(project);
    const target = path.posix.join(directory === "." ? "" : directory, "obj", "project.assets.json");
    await add("dotnet:" + project, "Restauración .NET", target, "file",
      "Existe obj/project.assets.json.", "No se encontró project.assets.json; ejecuta dotnet restore y revisa el resultado.");
  }
  for (const file of inspection.manifests.filter((item) => path.posix.basename(item).toLowerCase() === "go.mod")) {
    items.push({
      id: "go:" + file, title: "Módulos Go", status: "manual", target: file,
      details: "La caché de módulos es global; JCLI no ejecuta go mod verify durante una comprobación de solo lectura."
    });
  }
  for (const file of inspection.manifests.filter((item) => path.posix.basename(item).toLowerCase() === "cargo.toml")) {
    items.push({
      id: "rust:" + file, title: "Crates Rust", status: "manual", target: file,
      details: "La caché de Cargo es global; JCLI no verifica descargas ejecutando Cargo en este diagnóstico."
    });
  }
  for (const file of inspection.manifests.filter((item) =>
    ["pom.xml", "build.gradle", "build.gradle.kts"].includes(path.posix.basename(item).toLowerCase()))) {
    items.push({
      id: "java:" + file, title: "Dependencias Java", status: "manual", target: file,
      details: "La resolución Maven/Gradle requiere ejecutar plugins o scripts del proyecto y queda pendiente de revisión explícita."
    });
  }
  if (!items.length) {
    items.push({
      id: "none", title: "Dependencias del proyecto", status: "manual", target: ".",
      details: "No se detectaron artefactos de dependencias que JCLI pueda verificar de forma local."
    });
  }
  return items;
}

function printVerification(items: SetupVerificationItem[]): void {
  console.log("\nJCLI Project Setup — verificación local");
  for (const item of items) {
    const label = item.status === "ready" ? "OK"
      : item.status === "missing" ? "FALTA"
      : item.status === "unsafe" ? "NO VERIFICADO"
      : "MANUAL";
    console.log("  [" + label + "] " + item.title + " — " + item.target);
    console.log("    " + item.details);
  }
  console.log("La verificación solo inspecciona el sistema de archivos; no ejecuta builds, scripts, instalaciones ni consultas a bases de datos.");
}

export async function exportSetupReport(
  inspection: SetupInspection,
  doctor: SetupDoctorReport,
  connections: DatabaseConnectionProfile[],
  plan: SetupPlan,
  generatedAt = new Date(),
  verification: SetupVerificationItem[] = []
): Promise<string> {
  const root = await realpath(inspection.root);
  const reportDirectory = path.join(root, ".troc", "setup-reports");
  await mkdir(reportDirectory, { recursive: true });
  const actualDirectory = await realpath(reportDirectory);
  const relativeDirectory = path.relative(root, actualDirectory);
  if (!relativeDirectory || path.isAbsolute(relativeDirectory) ||
      relativeDirectory === ".." || relativeDirectory.startsWith(".." + path.sep)) {
    throw new Error("La carpeta del informe debe permanecer dentro del proyecto.");
  }

  // El informe exportado omite rutas absolutas, ejecutables locales y comandos completos.
  const payload = {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    project: {
      name: inspection.name,
      filesScanned: inspection.filesScanned,
      truncated: inspection.truncated,
      kinds: inspection.kinds,
      languages: inspection.languages,
      manifests: inspection.manifests,
      solutions: inspection.solutions,
      dotnetProjects: inspection.dotnetProjects,
      sqlProjects: inspection.sqlProjects,
      databaseEngines: inspection.databaseEngines,
      databaseLibraries: inspection.databaseLibraries,
      connectionFiles: inspection.connectionFiles,
      connectionNames: inspection.connectionNames,
      sqlScriptCount: inspection.sqlScripts.length,
      migrationCount: inspection.migrations.length,
      backupCount: inspection.backups.length,
      warnings: inspection.warnings
    },
    environment: {
      tools: doctor.tools.map((item) => ({
        id: item.id, name: item.name, required: item.required,
        installed: item.installed, ...(item.version ? { version: item.version } : {}),
        note: item.note
      })),
      ides: doctor.ides.map((item) => ({
        name: item.name, installed: item.installed, details: item.details
      })),
      visualStudioComponents: doctor.visualStudioComponents,
      databaseServices: doctor.databaseServices.map((item) => ({
        engine: item.engine, state: item.state,
        details: "Estado local reportado por el administrador de servicios; identificadores omitidos."
      })),
      missingRequired: doctor.missingRequired
    },
    connections: connections.map((item) => ({
      file: item.file, name: item.name,
      serverConfigured: item.serverConfigured,
      portConfigured: item.portConfigured,
      databaseConfigured: item.databaseConfigured,
      authentication: item.authentication,
      environmentVariables: item.environmentVariables
    })),
    setupPlan: {
      actions: plan.actions.map((item) => ({
        id: item.id, title: item.title, description: item.description
      })),
      manualSteps: plan.manualSteps
    },
    verification,
    privacy: {
      absolutePathsIncluded: false,
      executablePathsIncluded: false,
      connectionStringValuesIncluded: false,
      credentialsIncluded: false,
      fullCommandsIncluded: false
    }
  };

  const serialized = JSON.stringify(payload, null, 2) + "\n";
  const safeTimestamp = generatedAt.toISOString().replace(/[:.]/g, "-");
  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = attempt === 0 ? "" : "-" + attempt;
    const destination = path.join(actualDirectory, "setup-" + safeTimestamp + suffix + ".json");
    try {
      await writeFile(destination, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return destination;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw new Error("No se pudo guardar el informe en la carpeta local del proyecto.");
    }
  }
  throw new Error("No se pudo crear un nombre único para el informe. No se sobrescribieron archivos.");
}

function printInspection(report: SetupInspection): void {
  console.log("JCLI Project Setup — análisis");
  console.log("Proyecto: " + report.name);
  console.log("Carpeta: " + report.root);
  console.log("Archivos revisados: " + report.filesScanned + (report.truncated ? " (límite alcanzado)" : ""));
  console.log("Tipos: " + (report.kinds.join(", ") || "sin identificar"));
  console.log("Lenguajes: " + (report.languages.join(", ") || "sin identificar"));
  console.log("Manifiestos: " + (report.manifests.join(", ") || "ninguno"));
  console.log("Soluciones: " + (report.solutions.join(", ") || "ninguna"));
  console.log("Proyectos .NET: " + (report.dotnetProjects.join(", ") || "ninguno"));
  console.log("Proyectos SQL: " + (report.sqlProjects.join(", ") || "ninguno"));
  console.log("Motores de base de datos: " + (report.databaseEngines.join(", ") || "no identificados"));
  console.log("Librerías de datos: " + (report.databaseLibraries.join(", ") || "no identificadas"));
  console.log("Archivos de conexión: " + (report.connectionFiles.join(", ") || "ninguno"));
  console.log("Nombres de conexión: " + (report.connectionNames.join(", ") || "ninguno"));
  console.log("Scripts SQL: " + report.sqlScripts.length + " | Migraciones: " + report.migrations.length + " | Respaldos: " + report.backups.length);
  for (const warning of report.warnings) console.log("Aviso: " + warning);
  console.log("Seguridad: no se imprimieron cadenas de conexión, contraseñas ni contenidos SQL.");
}
function printPlan(plan: SetupPlan): void {
  console.log("JCLI Project Setup — plan");
  console.log("Proyecto: " + plan.inspection.name);
  if (!plan.actions.length) console.log("No hay restauraciones automáticas compatibles.");
  for (const item of plan.actions) {
    console.log("\n[" + item.id + "] " + item.title);
    console.log("  " + item.description);
    console.log("  Comando: " + item.command);
    console.log("  Carpeta: " + item.cwd);
  }
  if (plan.manualSteps.length) {
    console.log("\nPasos manuales:");
    for (const step of plan.manualSteps) console.log("  - " + step);
  }
  console.log("\nEl plan no ejecuta comandos ni modifica archivos.");
  if (plan.actions.length) console.log('Para aplicar las restauraciones, ejecuta: troc setup run "' + plan.inspection.root + '" --confirm');
}
export async function runSetupCommand(actionName: string | undefined, args: string[]): Promise<void> {
  if (!actionName || !["inspect","plan","run","report","doctor","db-config","db-test","all","verify","vsconfig"].includes(actionName)) {
    throw new Error("Uso: troc setup <all|inspect|plan|run|report|doctor|db-config|db-test|verify|vsconfig> <RUTA> [PERFIL] [--confirm].");
  }
  if (!args[0]) throw new Error("Indica la ruta de la carpeta del proyecto.");
  if ((actionName === "doctor" || actionName === "db-config") && args.length !== 1) throw new Error("Este diagnóstico acepta una sola ruta de proyecto.");
  if (actionName === "vsconfig" && (args.length !== 2 || args[1] !== "--confirm")) {
    throw new Error('Generar .vsconfig requiere --confirm. Uso: troc setup vsconfig "' + args[0] + '" --confirm.');
  }
  if (actionName === "report" && (args.length > 2 || (args.length === 2 && args[1] !== "--json"))) {
    throw new Error('Uso: troc setup report "' + args[0] + '" [--json].');
  }
  if (actionName === "all" && (args.length > 2 || (args.length === 2 && args[1] !== "--confirm"))) {
    throw new Error('Uso: troc setup all "' + args[0] + '" [--confirm]. Sin --confirm solo genera los diagnósticos; con --confirm ejecuta las restauraciones admitidas.');
  }
  if (actionName === "db-test" && (args.length !== 3 || args[2] !== "--confirm")) {
    throw new Error('La prueba requiere --confirm. Primero consulta troc setup db-config "' + args[0] + '" y después usa troc setup db-test "' + args[0] + '" NOMBRE --confirm.');
  }
  if (actionName === "run" && (args.length !== 2 || args[1] !== "--confirm")) {
    throw new Error('La ejecución requiere --confirm. Consulta primero: troc setup plan "' + args[0] + '".');
  }
  if (actionName !== "run" && actionName !== "db-test" && actionName !== "all" && actionName !== "vsconfig" && args.length !== 1) throw new Error("Indica una sola ruta; usa comillas si contiene espacios.");
  const report = await inspectProjectForSetup(args[0]);
  if (actionName === "inspect") { printInspection(report); return; }
  if (actionName === "vsconfig") {
    const destination = await exportVisualStudioConfiguration(report);
    const requirements = buildVisualStudioComponentRequirements(report);
    console.log("Configuración de Visual Studio 2026 guardada: " + destination);
    console.log("Componentes incluidos:");
    for (const item of requirements) console.log("  - " + item.name + " (" + item.id + ")");
    console.log("Abre Visual Studio Installer, elige la instancia de VS 2026 y usa Importar configuración para seleccionar este archivo.");
    console.log("El archivo solo agrega componentes; no elimina cargas de trabajo o componentes existentes.");
    return;
  }
  if (actionName === "verify") {
    printVerification(await verifySetupArtifacts(report));
    return;
  }
  if (actionName === "report") {
    const doctor = await inspectProjectEnvironment(report);
    const connections = await inspectDatabaseConfiguration(report);
    const plan = createSetupPlan(report);
    const verification = await verifySetupArtifacts(report);
    printInspection(report);
    printDoctor(doctor);
    printDatabaseConfiguration(connections);
    printPlan(plan);
    printVerification(verification);
    if (args[1] === "--json") {
      const destination = await exportSetupReport(report, doctor, connections, plan, new Date(), verification);
      console.log("\nInforme JSON guardado: " + destination);
      console.log("El archivo omite rutas absolutas, ejecutables locales, comandos completos y valores de conexión.");
    }
    return;
  }
  if (actionName === "doctor") { printDoctor(await inspectProjectEnvironment(report)); return; }
  if (actionName === "db-config") { printDatabaseConfiguration(await inspectDatabaseConfiguration(report)); return; }
  if (actionName === "db-test") {
    const result = await executeDatabaseConnectionTest(report, args[1], true);
    console.log("Perfil: " + result.name + " (" + result.file + ")");
    console.log("Resultado: " + (result.status === "success" ? "conexión correcta" : result.status === "timeout" ? "tiempo agotado" : "falló la conexión"));
    console.log("Duración: " + result.durationMs + " ms");
    if (result.status === "success") console.log("La consulta fija SELECT 1 respondió correctamente. No se modificó la base de datos.");
    else console.log("No se obtuvo confirmación de conexión. Revisa el servicio, la instancia, los permisos y el certificado; no se muestran detalles de conexión.");
    return;
  }
  if (actionName === "all") {
    printInspection(report);
    printDoctor(await inspectProjectEnvironment(report));
    printDatabaseConfiguration(await inspectDatabaseConfiguration(report));
    const fullPlan = createSetupPlan(report);
    printPlan(fullPlan);
    printVerification(await verifySetupArtifacts(report));
    if (args[1] !== "--confirm") {
      console.log("\nNo se ejecutó ninguna acción ni se modificó el proyecto.");
      console.log('Para ejecutar únicamente las restauraciones admitidas, vuelve a usar: troc setup all "' + args[0] + '" --confirm');
      console.log("Las pruebas de conexión SQL, migraciones y cambios de base de datos siguen requiriendo comandos separados y explícitos.");
      return;
    }
    if (!fullPlan.actions.length) {
      console.log("\nNo hay restauraciones automáticas disponibles; revisa los pasos manuales.");
      return;
    }
    console.log("\nSe ejecutarán las restauraciones conocidas del plan. No se ejecutarán SQL ni migraciones.");
    const fullResults = await executeSetupPlan(fullPlan, true);
    console.log("\nResultados:");
    for (const result of fullResults) {
      console.log("[" + result.status + "] " + result.title + " — " + result.durationMs + " ms; código " +
        (result.exitCode === null ? "sin código" : result.exitCode));
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.log("Salida de error:\n" + result.stderr);
    }
    const refreshed = await inspectProjectForSetup(args[0]);
    printVerification(await verifySetupArtifacts(refreshed));
    if (fullResults.some((item) => item.status !== "success")) {
      throw new Error("Una o más restauraciones fallaron; las acciones posteriores se detuvieron.");
    }
    return;
  }
  const plan = createSetupPlan(report);
  if (actionName === "plan") { printPlan(plan); return; }
  printPlan(plan);
  console.log("\nSolo se ejecutarán restauraciones conocidas. Se omiten scripts de terceros cuando el gestor lo permite.");
  console.log("No se ejecutarán SQL, migraciones, compilaciones ni comandos de creación de bases de datos.");
  const results = await executeSetupPlan(plan, true);
  console.log("\nResultados:");
  for (const result of results) {
    console.log("[" + result.status + "] " + result.title + " — " + result.durationMs + " ms; código " +
      (result.exitCode === null ? "sin código" : result.exitCode));
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.log("Salida de error:\n" + result.stderr);
  }
  const refreshed = await inspectProjectForSetup(args[0]);
  printVerification(await verifySetupArtifacts(refreshed));
  if (results.some((item) => item.status !== "success")) throw new Error("Una o más restauraciones fallaron; revisa los resultados.");
}
