import { existsSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface IdeInstallation {
  id: "vscode" | "vs2026" | "ssms22";
  name: string;
  installed: boolean;
  executable?: string;
  version?: string;
  details: string;
}

async function findOnPath(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(process.platform === "win32" ? "where.exe" : "which", [command], {
      windowsHide: true,
      timeout: 4000,
      maxBuffer: 256 * 1024
    });
    return stdout.split(/\\r?\\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

export async function detectVSCode(): Promise<IdeInstallation> {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"]!, "Microsoft VS Code", "Code.exe")
  ].filter((item): item is string => Boolean(item));
  let executable = candidates.find(existsSync) ?? await findOnPath("code");
  if (executable?.toLowerCase().endsWith("code.cmd")) {
    const adjacentExe = path.resolve(path.dirname(executable), "..", "Code.exe");
    if (existsSync(adjacentExe)) executable = adjacentExe;
  }
  if (!executable) return { id: "vscode", name: "Visual Studio Code", installed: false, details: "No se encontró Code.exe ni el comando code en PATH." };

  let version: string | undefined;
  try {
    const { stdout } = await execFileAsync(executable, ["--version"], { windowsHide: true, timeout: 5000 });
    version = stdout.split(/\\r?\\n/)[0]?.trim();
  } catch {
    // El ejecutable fue localizado, aunque no respondió a --version.
  }
  return { id: "vscode", name: "Visual Studio Code", installed: true, executable, version, details: "Instalación localizada." };
}

export async function detectVisualStudio2026(): Promise<IdeInstallation> {
  if (process.platform !== "win32") {
    return { id: "vs2026", name: "Visual Studio 2026", installed: false, details: "La detección está preparada para Windows." };
  }
  const roots = [
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"]!, "Microsoft Visual Studio", "Installer", "vswhere.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft Visual Studio", "Installer", "vswhere.exe")
  ].filter((item): item is string => Boolean(item));
  const vswhere = roots.find(existsSync);
  if (!vswhere) return { id: "vs2026", name: "Visual Studio 2026", installed: false, details: "No se encontró vswhere.exe." };

  try {
    const { stdout } = await execFileAsync(vswhere, [
      "-latest", "-products", "*", "-version", "[18.0,19.0)", "-property", "installationPath"
    ], { windowsHide: true, timeout: 8000 });
    const installation = stdout.trim();
    if (!installation) return { id: "vs2026", name: "Visual Studio 2026", installed: false, details: "No se encontró una instalación de la versión 2026 (18.x)." };
    const executable = path.join(installation, "Common7", "IDE", "devenv.exe");
    return {
      id: "vs2026",
      name: "Visual Studio 2026",
      installed: existsSync(executable),
      executable,
      details: existsSync(executable) ? "Instalación 2026 localizada." : "Se encontró la instalación, pero falta devenv.exe."
    };
  } catch {
    return { id: "vs2026", name: "Visual Studio 2026", installed: false, details: "No fue posible consultar vswhere." };
  }
}


export function findSSMS22Executable(
  roots: Array<string | undefined>,
  exists: (candidate: string) => boolean = existsSync
): string | undefined {
  const candidates = roots.filter((root): root is string => Boolean(root)).flatMap((root) => [
    path.join(root, "Microsoft SQL Server Management Studio 22", "Release", "Common7", "IDE", "Ssms.exe"),
    path.join(root, "Microsoft SQL Server Management Studio 22", "Common7", "IDE", "Ssms.exe"),
    path.join(root, "Microsoft SQL Server Management Studio 22", "Ssms.exe")
  ]);
  return candidates.find(exists);
}

export async function detectSSMS22(): Promise<IdeInstallation> {
  if (process.platform !== "win32") {
    return {
      id: "ssms22",
      name: "SQL Server Management Studio 22",
      installed: false,
      details: "SSMS 22 solo está disponible para Windows."
    };
  }
  const configuredPath = process.env.SSMS22_PATH?.trim();
  const configuredExecutable = configuredPath
    ? (configuredPath.toLowerCase().endsWith(".exe") ? configuredPath : path.join(configuredPath, "Ssms.exe"))
    : undefined;
  const discovered = findSSMS22Executable([
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"]
  ]);
  const executable = [configuredExecutable, discovered].find((candidate) =>
    Boolean(candidate && existsSync(candidate))
  );
  if (!executable) {
    return {
      id: "ssms22",
      name: "SQL Server Management Studio 22",
      installed: false,
      details: "No se encontró Ssms.exe en la ruta habitual. Puedes definir SSMS22_PATH con la ruta de Ssms.exe."
    };
  }
  return {
    id: "ssms22",
    name: "SQL Server Management Studio 22",
    installed: true,
    executable,
    details: "Instalación de SSMS 22 localizada."
  };
}
