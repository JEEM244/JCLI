import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DevCommand, DevAction, ProjectToolchain } from "./types.js";

const ignored = new Set([
  ".git", ".vs", ".idea", "node_modules", "vendor", "bin", "obj",
  "dist", "build", "coverage", ".next", ".angular"
]);

interface PackageManifest {
  scripts?: Record<string, unknown>;
}

async function findDotnetTarget(root: string): Promise<string | undefined> {
  async function walk(directory: string, depth: number): Promise<string | undefined> {
    if (depth > 3) return undefined;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return undefined;
    }
    const target = entries.find((entry) =>
      entry.isFile() && /\.(sln|slnx)$/i.test(entry.name)
    ) ?? entries.find((entry) =>
      entry.isFile() && /\.csproj$/i.test(entry.name)
    );
    if (target) return path.join(directory, target.name);
    for (const entry of entries) {
      if (entry.isDirectory() && !ignored.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")) {
        const found = await walk(path.join(directory, entry.name), depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  }
  return walk(root, 0);
}

async function findSqlProject(root: string): Promise<string | undefined> {
  async function walk(directory: string, depth: number): Promise<string | undefined> {
    if (depth > 3) return undefined;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return undefined;
    }
    const target = entries.find((entry) => entry.isFile() && /\.sqlproj$/i.test(entry.name));
    if (target) return path.join(directory, target.name);
    for (const entry of entries) {
      if (entry.isDirectory() && !ignored.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")) {
        const found = await walk(path.join(directory, entry.name), depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  }
  return walk(root, 0);
}

function npmCommand(action: DevAction, scriptName: string): DevCommand {
  const args = ["run", scriptName];
  return {
    tool: "npm",
    action,
    executable: process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm",
    args: process.platform === "win32" ? ["/d", "/s", "/c", "npm run " + scriptName] : args,
    display: "npm run " + scriptName,
    note: "Ejecuta el script definido por el proyecto en package.json."
  };
}

export async function detectToolchain(projectId: string, directory: string): Promise<ProjectToolchain> {
  const detected: string[] = [];
  const commands: DevCommand[] = [];
  const warnings: string[] = [];

  try {
    const raw = await readFile(path.join(directory, "package.json"), "utf8");
    const manifest = JSON.parse(raw) as PackageManifest;
    const scripts = manifest.scripts ?? {};
    detected.push("Node.js / npm");
    if (typeof scripts.build === "string") commands.push(npmCommand("build", "build"));
    if (typeof scripts.test === "string") commands.push(npmCommand("test", "test"));
    if (!commands.some((item) => item.tool === "npm")) {
      warnings.push("package.json no declara scripts build ni test.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push("No se pudo leer package.json: " +
        (error instanceof Error ? error.message : "JSON no válido"));
    }
  }

  const dotnetTarget = await findDotnetTarget(directory);
  if (dotnetTarget) {
    detected.push(".NET / Visual Studio");
    const relative = path.relative(directory, dotnetTarget);
    commands.push({
      tool: "dotnet",
      action: "build",
      executable: "dotnet",
      args: ["build", relative, "--nologo"],
      display: "dotnet build " + relative + " --nologo",
      note: "Compila la solución o proyecto .NET detectado."
    });
    commands.push({
      tool: "dotnet",
      action: "test",
      executable: "dotnet",
      args: ["test", relative, "--nologo"],
      display: "dotnet test " + relative + " --nologo",
      note: "Ejecuta las pruebas .NET descubiertas por el SDK."
    });
  }

  const sqlProject = await findSqlProject(directory);
  if (sqlProject) {
    detected.push("SQL Server Database Project (.sqlproj)");
    const relative = path.relative(directory, sqlProject);
    try {
      const sqlProjectText = await readFile(sqlProject, "utf8");
      const usesSqlSdk =
        /<Project\b[^>]*\bSdk\s*=\s*["'][^"']*Microsoft\.Build\.Sql/i.test(sqlProjectText) ||
        /<Sdk\b[^>]*\bName\s*=\s*["']Microsoft\.Build\.Sql/i.test(sqlProjectText);
      if (usesSqlSdk) {
        commands.push({
          tool: "dotnet",
          action: "build",
          executable: "dotnet",
          args: ["build", relative, "--nologo"],
          display: "dotnet build " + relative + " --nologo",
          note: "Compila el proyecto SQL SDK-style basado en Microsoft.Build.Sql. No ejecuta scripts contra una base de datos."
        });
      } else {
        warnings.push("Se detectó un .sqlproj clásico. JCLI no inventará un comando dotnet build: puede requerir MSBuild y SSDT de Visual Studio.");
      }
    } catch {
      warnings.push("No se pudo leer el archivo .sqlproj para identificar su tipo de proyecto.");
    }
  }

  try {
    const raw = await readFile(path.join(directory, "composer.json"), "utf8");
    const manifest = JSON.parse(raw) as PackageManifest;
    detected.push("PHP / Composer");
    if (manifest.scripts?.test !== undefined) {
      commands.push({
        tool: "composer",
        action: "test",
        executable: process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "composer",
        args: process.platform === "win32" ? ["/d", "/s", "/c", "composer test"] : ["test"],
        display: "composer test",
        note: "Ejecuta el script test declarado por composer.json."
      });
    } else {
      warnings.push("composer.json no declara un script test; no se ejecutará una prueba inventada.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push("No se pudo leer composer.json: " +
        (error instanceof Error ? error.message : "JSON no válido"));
    }
  }

  try {
    await readFile(path.join(directory, "pyproject.toml"), "utf8");
    detected.push("Python / pyproject.toml");
    commands.push({
      tool: "pytest",
      action: "test",
      executable: process.platform === "win32" ? "py" : "python3",
      args: process.platform === "win32" ? ["-m", "pytest", "-q"] : ["-m", "pytest", "-q"],
      display: process.platform === "win32" ? "py -m pytest -q" : "python3 -m pytest -q",
      note: "Necesita pytest ya instalado. No instala dependencias."
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push("No se pudo leer pyproject.toml.");
    }
  }

  try {
    await readFile(path.join(directory, "go.mod"), "utf8");
    detected.push("Go");
    commands.push({
      tool: "go", action: "build", executable: "go", args: ["build", "./..."],
      display: "go build ./...", note: "Compila los paquetes Go del módulo."
    });
    commands.push({
      tool: "go", action: "test", executable: "go", args: ["test", "./..."],
      display: "go test ./...", note: "Ejecuta las pruebas Go del módulo."
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push("No se pudo leer go.mod.");
  }

  try {
    await readFile(path.join(directory, "Cargo.toml"), "utf8");
    detected.push("Rust / Cargo");
    commands.push({
      tool: "cargo", action: "build", executable: "cargo", args: ["build"],
      display: "cargo build", note: "Compila el proyecto Rust."
    });
    commands.push({
      tool: "cargo", action: "test", executable: "cargo", args: ["test"],
      display: "cargo test", note: "Ejecuta las pruebas Rust."
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push("No se pudo leer Cargo.toml.");
  }

  if (!detected.length) warnings.push("No se reconoció un manifiesto compatible en la raíz del proyecto.");
  return { projectId, directory, detected, commands, warnings };
}

export function getCommand(toolchain: ProjectToolchain, action: DevAction): DevCommand[] {
  return toolchain.commands.filter((command) => command.action === action);
}
