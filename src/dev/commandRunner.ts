import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DevCommand, DevRun, DevStatus } from "./types.js";

const OUTPUT_LIMIT = 48000;
const DEFAULT_TIMEOUT = 180000;
const MAX_TIMEOUT = 600000;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_TIMEOUT) : fallback;
}

function appendLimited(current: string, chunk: string): string {
  const next = current + chunk;
  if (next.length <= OUTPUT_LIMIT) return next;
  return next.slice(0, OUTPUT_LIMIT) + "\n[Salida recortada por el límite local de JCLI.]";
}

function safeRelativeTarget(target: string): boolean {
  return Boolean(target) && !path.isAbsolute(target) &&
    !target.split(/[\\/]+/).some((part) => part === "..");
}

function validateCommand(command: DevCommand): void {
  if (command.tool === "npm") {
    const expected = "npm run " + command.action;
    const validWindows = process.platform === "win32" &&
      command.executable === (process.env.ComSpec || "cmd.exe") &&
      JSON.stringify(command.args) === JSON.stringify(["/d", "/s", "/c", expected]);
    const validOther = process.platform !== "win32" &&
      command.executable === "npm" &&
      JSON.stringify(command.args) === JSON.stringify(["run", command.action]);
    if (command.display !== expected || (!validWindows && !validOther)) {
      throw new Error("Se bloqueó un comando npm que no coincide con los perfiles permitidos.");
    }
    return;
  }

  if (command.tool === "dotnet") {
    const [verb, target, flag, extra] = command.args;
    if (command.executable !== "dotnet" || verb !== command.action ||
        !target || !safeRelativeTarget(target) || flag !== "--nologo" || extra !== undefined ||
        command.display !== "dotnet " + verb + " " + target + " --nologo") {
      throw new Error("Se bloqueó un comando .NET que no coincide con los perfiles permitidos.");
    }
    return;
  }

  if (command.tool === "composer") {
    const validWindows = process.platform === "win32" &&
      command.executable === (process.env.ComSpec || "cmd.exe") &&
      JSON.stringify(command.args) === JSON.stringify(["/d", "/s", "/c", "composer test"]);
    const validOther = process.platform !== "win32" &&
      command.executable === "composer" && JSON.stringify(command.args) === JSON.stringify(["test"]);
    if (command.action !== "test" || command.display !== "composer test" || (!validWindows && !validOther)) {
      throw new Error("Se bloqueó un comando Composer que no coincide con los perfiles permitidos.");
    }
    return;
  }

  if (command.tool === "pytest") {
    const executable = process.platform === "win32" ? "py" : "python3";
    if (command.action !== "test" || command.executable !== executable ||
        JSON.stringify(command.args) !== JSON.stringify(["-m", "pytest", "-q"])) {
      throw new Error("Se bloqueó un comando Python que no coincide con los perfiles permitidos.");
    }
    return;
  }

  if (command.tool === "go" || command.tool === "cargo") {
    const expectedExecutable = command.tool;
    const expectedArgs = command.tool === "go"
      ? [command.action === "build" ? "build" : "test", "./..."]
      : [command.action === "build" ? "build" : "test"];
    const expectedDisplay = expectedExecutable + " " + expectedArgs.join(" ");
    if (command.executable !== expectedExecutable ||
        JSON.stringify(command.args) !== JSON.stringify(expectedArgs) ||
        command.display !== expectedDisplay) {
      throw new Error("Se bloqueó un comando " + command.tool + " fuera del perfil permitido.");
    }
    return;
  }

  throw new Error("La herramienta solicitada no está permitida por JCLI.");
}

function childEnvironment(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE[_-]?KEY)/i.test(key)) continue;
    safe[key] = value;
  }
  safe.CI = process.env.CI || "1";
  return safe;
}

export class CommandRunner {
  async run(projectId: string, directory: string, command: DevCommand): Promise<DevRun> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const timeoutMs = positiveInteger(process.env.JCLI_DEV_TIMEOUT_MS, DEFAULT_TIMEOUT);
    try {
      validateCommand(command);
    } catch (error) {
      return this.result(projectId, command, startedAt, started, "failure", null, false, "",
        error instanceof Error ? error.message : "Comando no permitido.");
    }

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let child;
      try {
        child = spawn(command.executable, command.args, {
          cwd: path.resolve(directory),
          shell: false,
          windowsHide: true,
          env: childEnvironment(),
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo iniciar el proceso.";
        resolve(this.result(projectId, command, startedAt, started, "failure", null, false, "", message));
        return;
      }

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

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
        stderr = appendLimited(stderr, error.message);
        resolve(this.result(projectId, command, startedAt, started, "failure", null, false, stdout, stderr));
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const status: DevStatus = timedOut ? "timeout" : code === 0 ? "success" : "failure";
        resolve(this.result(projectId, command, startedAt, started, status, code, timedOut, stdout, stderr));
      });
    });
  }

  private result(
    projectId: string,
    command: DevCommand,
    startedAt: string,
    started: number,
    status: DevStatus,
    exitCode: number | null,
    timedOut: boolean,
    stdout: string,
    stderr: string
  ): DevRun {
    return {
      id: randomUUID(),
      projectId,
      action: command.action,
      tool: command.tool,
      command: command.display,
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      exitCode,
      timedOut,
      stdout,
      stderr
    };
  }
}
