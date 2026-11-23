import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const MAX_SQL_SCRIPT_BYTES = 2 * 1024 * 1024;

export interface SqlScriptInspection {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  lineCount: number;
}

/** Reads basic metadata only; it never connects to SQL Server or executes SQL. */
export async function inspectSqlScript(
  projectDirectory: string,
  requestedPath: string
): Promise<SqlScriptInspection> {
  if (!requestedPath.trim()) {
    throw new Error("No se recibió la ruta del archivo SQL. Abre un archivo .sql en SSMS y vuelve a ejecutar la herramienta.");
  }
  const root = await realpath(projectDirectory);
  const candidate = path.resolve(root, requestedPath);
  const entry = await lstat(candidate);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error("El archivo indicado no es un archivo local normal.");
  }
  const absolutePath = await realpath(candidate);
  const relativePath = path.relative(root, absolutePath);
  if (!relativePath || relativePath === ".." ||
      relativePath.startsWith(".." + path.sep) || path.isAbsolute(relativePath)) {
    throw new Error("El archivo SQL debe estar dentro de la carpeta del proyecto registrado.");
  }
  if (path.extname(absolutePath).toLowerCase() !== ".sql") {
    throw new Error("Solo se admiten archivos con extensión .sql.");
  }
  const fileStats = await stat(absolutePath);
  if (fileStats.size > MAX_SQL_SCRIPT_BYTES) {
    throw new Error("El archivo supera el límite de inspección de 2 MiB.");
  }
  const content = await readFile(absolutePath, "utf8");
  const lineCount = content.length === 0 ? 0 : content.split(/\r\n|\n|\r/).length;
  return { absolutePath, relativePath, sizeBytes: fileStats.size, lineCount };
}
