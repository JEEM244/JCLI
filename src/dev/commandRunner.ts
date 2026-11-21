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

export class CommandRunner {
  async run(projectId: string, directory: string, command: DevCommand): Promise<DevRun> {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const timeoutMs = positiveInteger(process.env.JCLI_DEV_TIMEOUT_MS, DEFAULT_TIMEOUT);

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
          env: { ...process.env, CI: process.env.CI || "1" },
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
