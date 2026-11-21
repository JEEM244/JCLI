import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DevService } from "../dist/dev/devService.js";
import { DevRunStore } from "../dist/dev/runStore.js";
import { HistoryStore } from "../dist/history/historyStore.js";

test("exige confirmación antes de ejecutar y almacena los resultados", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-dev-service-"));
  let calls = 0;
  try {
    const projectDirectory = path.join(directory, "project");
    await (await import("node:fs/promises")).mkdir(projectDirectory);
    await writeFile(path.join(projectDirectory, "package.json"), JSON.stringify({
      scripts: { build: "tsc" }
    }), "utf8");

    const projects = {
      get: async (id) => id === "WEB"
        ? { id, name: "Web", directory: projectDirectory, description: "", created: "2026-11-20" }
        : undefined
    };
    const runner = {
      run: async (projectId, _directory, command) => {
        calls++;
        return {
          id: randomUUID(),
          projectId,
          action: command.action,
          tool: command.tool,
          command: command.display,
          status: "success",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 10,
          exitCode: 0,
          timedOut: false,
          stdout: "OK",
          stderr: ""
        };
      }
    };
    const runs = new DevRunStore(path.join(directory, "runs"));
    const history = new HistoryStore(path.join(directory, "history.jsonl"));
    const service = new DevService(projects, runner, runs, history);

    await assert.rejects(() => service.run("WEB", "build", false), /--confirm/);
    assert.equal(calls, 0);

    const result = await service.run("WEB", "build", true);
    assert.equal(calls, 1);
    assert.equal(result[0].status, "success");
    assert.equal((await service.getRun(result[0].id)).stdout, "OK");
    assert.equal((await history.list(5))[0].action, "dev.command_finished");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("crea tareas de VS Code solo con confirmación y nunca sobrescribe un archivo existente", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-vscode-tasks-"));
  try {
    const projectDirectory = path.join(directory, "project");
    await (await import("node:fs/promises")).mkdir(projectDirectory);
    await writeFile(path.join(projectDirectory, "package.json"), JSON.stringify({
      scripts: { build: "tsc", test: "node --test" }
    }), "utf8");
    const projects = {
      get: async () => ({ id: "WEB", name: "Web", directory: projectDirectory })
    };
    const service = new DevService(projects);
    await assert.rejects(
      () => service.configureVSCodeTasks("WEB", false),
      /--confirm/
    );
    const tasksPath = await service.configureVSCodeTasks("WEB", true);
    const tasks = JSON.parse(await (await import("node:fs/promises")).readFile(tasksPath, "utf8"));
    assert.equal(tasks.version, "2.0.0");
    assert.equal(tasks.tasks.length, 2);
    assert.match(tasks.tasks[0].label, /JCLI: BUILD/);
    assert.equal(tasks.tasks[0].options.cwd, "${workspaceFolder}");
    await assert.rejects(
      () => service.configureVSCodeTasks("WEB", true),
      /no lo sobrescribirá/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
