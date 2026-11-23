import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { SetupInspection } from "./projectSetup.js";
import { parseXmlConnectionEntries } from "./connectionConfig.js";

const execFileAsync = promisify(execFile);
const MAX_CONFIG_SIZE = 384 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
export const READ_ONLY_PROBE_QUERY = "SET NOCOUNT ON; SELECT 1;";

interface InternalProfile {
  file: string;
  name: string;
  connectionString: string;
}
export interface DatabaseConnectionTestResult {
  status: "success" | "failed" | "timeout";
  file: string;
  name: string;
  durationMs: number;
}
export interface DatabaseConnectionTestOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  resolveExecutable?: () => Promise<string | undefined>;
  runner?: (
    executable: string,
    args: string[],
    timeoutMs: number,
    env: NodeJS.ProcessEnv
  ) => Promise<{ exitCode: number | null; timedOut: boolean }>;
}

function parseAttributes(input: string): Map<string, string> {
  const fields = new Map<string, string>();
  let index = 0;
  while (index < input.length) {
    while (index < input.length && (input[index] === ";" || /\s/.test(input[index]))) index++;
    if (index >= input.length) break;
    const keyStart = index;
    while (index < input.length && input[index] !== "=" && input[index] !== ";") index++;
    if (input[index] !== "=") {
      while (index < input.length && input[index] !== ";") index++;
      continue;
    }
    const key = input.slice(keyStart, index).trim().toLowerCase().replace(/[\s_]/g, "");
    index++;
    while (index < input.length && /\s/.test(input[index])) index++;
    let value = "";
    const quote = input[index];
    if (quote === '"' || quote === "'") {
      index++;
      while (index < input.length) {
        if (input[index] === quote) {
          if (input[index + 1] === quote) {
            value += quote;
            index += 2;
          } else {
            index++;
            break;
          }
        } else {
          value += input[index++];
        }
      }
      while (index < input.length && input[index] !== ";") index++;
    } else if (quote === "{") {
      index++;
      while (index < input.length) {
        if (input[index] === "}") {
          if (input[index + 1] === "}") {
            value += "}";
            index += 2;
          } else {
            index++;
            break;
          }
        } else {
          value += input[index++];
        }
      }
      while (index < input.length && input[index] !== ";") index++;
    } else {
      const start = index;
      while (index < input.length && input[index] !== ";") index++;
      value = input.slice(start, index).trim();
    }
    if (key) fields.set(key, value);
  }
  return fields;
}

function collectProfiles(value: unknown, file: string, result: InternalProfile[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === "connectionstrings" && child && typeof child === "object" && !Array.isArray(child)) {
      for (const [name, connection] of Object.entries(child as Record<string, unknown>)) {
        if (typeof connection === "string") result.push({ file, name, connectionString: connection });
      }
    } else {
      collectProfiles(child, file, result);
    }
  }
}

async function readProfiles(report: SetupInspection): Promise<InternalProfile[]> {
  const root = await realpath(report.root);
  const profiles: InternalProfile[] = [];
  for (const file of report.connectionFiles) {
    const candidate = path.resolve(root, file);
    const relative = path.relative(root, candidate);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) continue;
    try {
      const actual = await realpath(candidate);
      const actualRelative = path.relative(root, actual);
      if (path.isAbsolute(actualRelative) || actualRelative === ".." || actualRelative.startsWith(".." + path.sep)) continue;
      const info = await stat(actual);
      if (!info.isFile() || info.size > MAX_CONFIG_SIZE) continue;
      const content = await readFile(actual, "utf8");
      const base = path.basename(file).toLowerCase();
      if (base === "web.config" || base === "app.config") {
        for (const entry of parseXmlConnectionEntries(content)) {
          profiles.push({ file, name: entry.name, connectionString: entry.connectionString });
        }
      } else {
        collectProfiles(JSON.parse(content) as unknown, file, profiles);
      }
    } catch {
      // No se muestran contenidos ni errores de archivos de configuración.
    }
  }
  return profiles;
}

function chooseProfile(profiles: InternalProfile[], selector: string): InternalProfile {
  const separator = selector.indexOf("::");
  const matches = separator >= 0
    ? profiles.filter((item) => item.file.toLowerCase() === selector.slice(0, separator).toLowerCase() &&
      item.name.toLowerCase() === selector.slice(separator + 2).toLowerCase())
    : profiles.filter((item) => item.name.toLowerCase() === selector.toLowerCase());
  if (!matches.length) throw new Error("No se encontró el perfil de conexión indicado en los archivos de configuración compatibles.");
  if (matches.length > 1) {
    const choices = matches.map((item) => item.file + "::" + item.name).join(", ");
    throw new Error("El perfil aparece en varios archivos. Selecciona uno con ARCHIVO::NOMBRE: " + choices);
  }
  return matches[0];
}

function expandEnvironmentReferences(
  value: string,
  env: NodeJS.ProcessEnv
): { value: string; missing: string[] } {
  const missing = new Set<string>();
  const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$\(([A-Za-z_][A-Za-z0-9_]*)\)|%([A-Za-z_][A-Za-z0-9_]*)%/g,
    (match, curly: string | undefined, paren: string | undefined, percent: string | undefined) => {
      const name = curly ?? paren ?? percent;
      const resolved = name ? env[name] : undefined;
      if (resolved === undefined || resolved.length === 0) {
        if (name) missing.add(name);
        return match;
      }
      return resolved;
    });
  return { value: expanded, missing: [...missing].sort() };
}

function requiredAttribute(fields: Map<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = fields.get(key);
    if (value?.trim()) return value.trim();
  }
  return "";
}

function safeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !/(token|secret|password|passwd|credential|api[_-]?key|authorization)/i.test(key)) {
      result[key] = value;
    }
  }
  return result;
}

async function locateSqlcmd(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const resolver = platform === "win32" ? "where.exe" : "which";
  for (const command of platform === "win32" ? ["sqlcmd.exe", "sqlcmd"] : ["sqlcmd"]) {
    try {
      const result = await execFileAsync(resolver, [command], {
        windowsHide: true, timeout: 4_000, maxBuffer: 256 * 1024, env: safeEnvironment(env)
      });
      const executable = String(result.stdout).split(/\r?\n/).map((item) => item.trim()).find(Boolean);
      if (executable) return executable;
    } catch {
      // Prueba el siguiente nombre conocido.
    }
  }
  return undefined;
}

async function runSqlcmd(
  executable: string,
  args: string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv
): Promise<{ exitCode: number | null; timedOut: boolean }> {
  try {
    await execFileAsync(executable, args, {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
      env: safeEnvironment(env)
    });
    return { exitCode: 0, timedOut: false };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : null,
      timedOut: Boolean(failure.killed || failure.signal === "SIGTERM" || failure.signal === "SIGKILL")
    };
  }
}

export async function executeDatabaseConnectionTest(
  report: SetupInspection,
  selector: string,
  confirmed: boolean,
  options: DatabaseConnectionTestOptions = {}
): Promise<DatabaseConnectionTestResult> {
  if (!confirmed) throw new Error("La prueba de conexión requiere confirmación explícita.");
  if (!selector.trim()) throw new Error("Indica el nombre del perfil de conexión.");
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    throw new Error("La primera prueba de SQL Server usa autenticación integrada de Windows y solo está disponible en Windows.");
  }

  const profiles = await readProfiles(report);
  const profile = chooseProfile(profiles, selector.trim());
  const env = options.env ?? process.env;
  const expanded = expandEnvironmentReferences(profile.connectionString, env);
  if (expanded.missing.length) {
    throw new Error("Faltan variables de entorno para el perfil: " + expanded.missing.join(", ") + ". No se intentó conectar.");
  }

  const fields = parseAttributes(expanded.value);
  const server = requiredAttribute(fields, ["server", "datasource", "address", "addr", "networkaddress"]);
  const database = requiredAttribute(fields, ["database", "initialcatalog"]);
  const integrated = ["integratedsecurity", "trustedconnection"]
    .some((key) => ["true", "yes", "sspi"].includes((fields.get(key) ?? "").toLowerCase()));
  const hasCredentials = ["userid", "uid", "user", "password", "pwd"].some((key) => fields.has(key));

  if (hasCredentials) {
    throw new Error("El perfil contiene campos de usuario o contraseña. Esta prueba solo admite autenticación integrada de Windows y no utilizará credenciales SQL.");
  }
  if (!integrated) {
    throw new Error("El perfil no declara autenticación integrada de Windows. No se intentó conectar.");
  }
  if (!server || !database) {
    throw new Error("El perfil necesita servidor y base de datos configurados. No se intentó conectar.");
  }
  if (server.startsWith("-") || database.startsWith("-") ||
      /[\u0000\r\n;]/.test(server) || /[\u0000\r\n;]/.test(database) ||
      server.length > 512 || database.length > 256) {
    throw new Error("El perfil contiene un servidor o nombre de base no compatible. No se intentó conectar.");
  }

  const resolveExecutable = options.resolveExecutable ??
    (() => locateSqlcmd(platform, env));
  const executable = await resolveExecutable();
  if (!executable) throw new Error("No se encontró sqlcmd. Instala las herramientas de línea de comandos de SQL Server y vuelve a ejecutar el diagnóstico.");

  const args = [
    "-S", server,
    "-d", database,
    "-E",
    "-b",
    "-l", "8",
    "-h", "-1",
    "-W",
    "-X1",
    "-Q", READ_ONLY_PROBE_QUERY
  ];
  const started = Date.now();
  const result = await (options.runner ?? runSqlcmd)(
    executable, args, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, env
  );
  return {
    status: result.timedOut ? "timeout" : result.exitCode === 0 ? "success" : "failed",
    file: profile.file,
    name: profile.name,
    durationMs: Date.now() - started
  };
}
