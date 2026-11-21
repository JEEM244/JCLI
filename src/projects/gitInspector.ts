import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitSummary {
  branch: string;
  changes: string[];
  clean: boolean;
}

export async function inspectGit(directory: string): Promise<GitSummary> {
  try {
    const { stdout: branchOutput } = await execFileAsync("git", ["-C", directory, "branch", "--show-current"], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    const { stdout: statusOutput } = await execFileAsync("git", ["-C", directory, "status", "--short"], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    const changes = statusOutput.split(/\\r?\\n/).filter(Boolean);
    return { branch: branchOutput.trim() || "(HEAD separado)", changes, clean: changes.length === 0 };
  } catch {
    throw new Error("No se pudo consultar Git. Verifica que Git esté instalado y que la carpeta sea un repositorio.");
  }
}
