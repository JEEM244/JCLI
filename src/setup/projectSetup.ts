import { spawn } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const IGNORED = new Set([".git", ".vs", ".idea", "node_modules", "vendor", "dist", "build", "coverage", "bin", "obj", ".venv", "venv", "__pycache__"]);
const MAX_FILES = 5000;
const MAX_DEPTH = 7;
const MAX_MANIFEST_SIZE = 384 * 1024;
const MAX_OUTPUT = 8000;
const TIMEOUT_MS = 180_000;

export interface SetupInspection {
  root: string; name: string; filesScanned: number; truncated: boolean;
  kinds: string[]; languages: string[]; manifests: string[];
  solutions: string[]; dotnetProjects: string[]; sqlProjects: string[];
  databaseEngines: string[]; databaseLibraries: string[];
  connectionFiles: string[]; connectionNames: string[];
  sqlScripts: string[]; migrations: string[]; backups: string[];
  packageDirectories: string[]; composerDirectories: string[];
  requirements: string[]; warnings: string[];
}
export interface SetupAction {
  id: string; title: string; description: string; executable: string;
  args: string[]; cwd: string; command: string; canRun: boolean;
}
export interface SetupPlan {
  inspection: SetupInspection; actions: SetupAction[]; manualSteps: string[];
}
export interface SetupRunResult {
  actionId: string; title: string; status: "success" | "failed" | "timeout";
  exitCode: number | null; durationMs: number; stdout: string; stderr: string;
}
type Runner = (executable: string, args: string[], cwd: string) =>
  Promise<Omit<SetupRunResult, "actionId" | "title">>;

const rel = (root: string, file: string): string => path.relative(root, file).split(path.sep).join("/");
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
  let truncated = false;
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) { truncated = true; return; }
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) { truncated = true; break; }
      if (entry.isDirectory()) {
        if (!IGNORED.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) files.push(path.join(dir, entry.name));
    }
  }
  await walk(root, 0);

  const paths = files.map((file) => rel(root, file));
  const lower = paths.map((file) => file.toLowerCase());
  const has = (file: string): boolean => lower.includes(file.toLowerCase());
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
  const manifestNames = new Set([
    "package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock",
    "composer.json", "composer.lock", "requirements.txt", "pyproject.toml", "pipfile",
    "cargo.toml", "cargo.lock", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts",
    "global.json", "directory.build.props", "angular.json", "schema.prisma"
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
        const parsed = JSON.parse(await readManifest(absolute)) as { dependencies?: Record<string,string>; devDependencies?: Record<string,string> };
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
      const content = await readManifest(absolute);
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
  if (solutions.length || dotnetProjects.length || sqlProjects.length) {
    kinds.add(".NET / Visual Studio"); requirements.add("Visual Studio 2026 o un editor compatible");
  }
  if (sqlProjects.length) { kinds.add("SQL Database Project"); requirements.add("SQL Server Data Tools o SDK de proyectos SQL compatible"); }
  if (paths.some((file) => /(^|\/)angular\.json$/i.test(file))) kinds.add("Angular");

  const warnings: string[] = [];
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
    manifests: [...new Set(manifests)].sort(), solutions, dotnetProjects, sqlProjects,
    databaseEngines: [...engines].sort(), databaseLibraries: [...libraries].sort(),
    connectionFiles: connectionFiles.sort(), connectionNames: [...connectionNames].sort(),
    sqlScripts, migrations, backups,
    packageDirectories: [...new Set(packageDirectories)].sort(),
    composerDirectories: [...new Set(composerDirectories)].sort(),
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
    const prefix = dir === "." ? "" : dir + "/";
    const lowerManifests = report.manifests.map((file) => file.toLowerCase());
    const manager = [
      { lock:"package-lock.json", name:"npm", exe:process.platform === "win32" ? "npm.cmd" : "npm", args:["ci","--ignore-scripts"], display:"npm ci --ignore-scripts" },
      { lock:"npm-shrinkwrap.json", name:"npm", exe:process.platform === "win32" ? "npm.cmd" : "npm", args:["ci","--ignore-scripts"], display:"npm ci --ignore-scripts" },
      { lock:"pnpm-lock.yaml", name:"pnpm", exe:process.platform === "win32" ? "pnpm.cmd" : "pnpm", args:["install","--frozen-lockfile","--ignore-scripts"], display:"pnpm install --frozen-lockfile --ignore-scripts" },
      { lock:"yarn.lock", name:"yarn", exe:process.platform === "win32" ? "yarn.cmd" : "yarn", args:["install","--frozen-lockfile","--ignore-scripts"], display:"yarn install --frozen-lockfile --ignore-scripts" }
    ].find((item) => lowerManifests.includes((prefix + item.lock).toLowerCase()));
    if (manager) actions.push(makeAction(manager.name + "-install-" + actions.length,
      "Restaurar dependencias de " + manager.name,
      "Usa el lockfile existente y desactiva scripts de instalación de terceros.",
      manager.exe, manager.args, path.join(report.root, dir === "." ? "" : dir), manager.display));
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
  if (report.requirements.includes("Python")) manualSteps.push("Python: crear un entorno virtual y revisar requirements.txt/pyproject.toml antes de instalar.");
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
    results.push({ actionId:item.id, title:item.title, ...(await runner(item.executable,item.args,item.cwd)) });
  }
  return results;
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
  if (!actionName || !["inspect","plan","run","report"].includes(actionName)) {
    throw new Error("Uso: troc setup <inspect|plan|run|report> <RUTA> [--confirm].");
  }
  if (!args[0]) throw new Error("Indica la ruta de la carpeta del proyecto.");
  if (actionName === "run" && (args.length !== 2 || args[1] !== "--confirm")) {
    throw new Error('La ejecución requiere --confirm. Consulta primero: troc setup plan "' + args[0] + '".');
  }
  if (actionName !== "run" && args.length !== 1) throw new Error("Indica una sola ruta; usa comillas si contiene espacios.");
  const report = await inspectProjectForSetup(args[0]);
  if (actionName === "inspect" || actionName === "report") { printInspection(report); return; }
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
  if (results.some((item) => item.status !== "success")) throw new Error("Una o más restauraciones fallaron; revisa los resultados.");
}
