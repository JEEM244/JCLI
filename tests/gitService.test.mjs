import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitService } from "../dist/git/gitService.js";
import { HistoryStore } from "../dist/history/historyStore.js";

function runGit(directory, args) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "JCLI Test",
      GIT_AUTHOR_EMAIL: "jcli-test@example.invalid",
      GIT_COMMITTER_NAME: "JCLI Test",
      GIT_COMMITTER_EMAIL: "jcli-test@example.invalid"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-git-"));
  const projectDirectory = path.join(directory, "project");
  await mkdir(path.join(projectDirectory, "src"), { recursive: true });
  runGit(projectDirectory, ["init"]);
  runGit(projectDirectory, ["checkout", "-b", "main"]);
  runGit(projectDirectory, ["config", "user.name", "JCLI Test"]);
  runGit(projectDirectory, ["config", "user.email", "jcli-test@example.invalid"]);
  await writeFile(path.join(projectDirectory, "src/app.ts"), "const value = 1;\n", "utf8");
  runGit(projectDirectory, ["add", "src/app.ts"]);
  runGit(projectDirectory, ["commit", "-m", "Initial commit"]);
  const projects = {
    get: async (id) => id === "WEB"
      ? { id, name: "Web", directory: projectDirectory, description: "", created: "2026-11-21" }
      : undefined
  };
  const history = new HistoryStore(path.join(directory, "history.jsonl"));
  return {
    directory,
    projectDirectory,
    service: new GitService(projects, history),
    history
  };
}

test("inspecciona el repositorio, muestra diff, prepara archivos y crea commits", async () => {
  const context = await setup();
  try {
    const initial = await context.service.inspect("WEB");
    assert.match(initial.branch, /^main/);
    assert.equal(initial.clean, true);

    await writeFile(path.join(context.projectDirectory, "src/app.ts"), "const value = 2;\n", "utf8");
    const diff = await context.service.diff("WEB");
    assert.match(diff, /-const value = 1/);
    assert.match(diff, /\+const value = 2/);

    await assert.rejects(
      () => context.service.stage("WEB", ["src/app.ts"], false),
      /--confirm/
    );
    await context.service.stage("WEB", ["src/app.ts"], true);

    const stagedDiff = await context.service.diff("WEB", true);
    assert.match(stagedDiff, /const value = 2/);

    const commit = await context.service.commit("WEB", "Actualiza valor", true);
    assert.match(commit.hash, /^[a-f0-9]{40,64}$/i);
    assert.equal(commit.subject, "Actualiza valor");

    const status = await context.service.inspect("WEB");
    assert.equal(status.clean, true);
    const history = await context.history.list(10);
    assert.ok(history.some((item) => item.action === "git.staged"));
    assert.ok(history.some((item) => item.action === "git.committed"));
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("permite retirar archivos del staging sin descartar cambios del área de trabajo", async () => {
  const context = await setup();
  try {
    await writeFile(path.join(context.projectDirectory, "src/app.ts"), "const value = 3;\n", "utf8");
    await context.service.stage("WEB", ["src/app.ts"], true);
    await context.service.unstage("WEB", ["src/app.ts"], true);
    assert.match(await readFile(path.join(context.projectDirectory, "src/app.ts"), "utf8"), /value = 3/);
    assert.match(await context.service.diff("WEB"), /value = 3/);
    assert.equal(await context.service.diff("WEB", true), "No hay diferencias para mostrar.");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("administra ramas locales con confirmación explícita", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () => context.service.createBranch("WEB", "feature/demo", false),
      /--confirm/
    );
    await context.service.createBranch("WEB", "feature/demo", true);
    const branches = await context.service.listBranches("WEB");
    assert.ok(branches.includes("main"));
    assert.ok(branches.includes("feature/demo"));

    await context.service.switchBranch("WEB", "main", true);
    assert.match((await context.service.inspect("WEB")).branch, /^main/);
    await assert.rejects(
      () => context.service.switchBranch("WEB", "missing", true),
      /no existe/
    );
    await assert.rejects(
      () => context.service.createBranch("WEB", "../bad", true),
      /inválido/
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("bloquea rutas externas, secretos, carpetas generadas y nombres de rama inseguros", async () => {
  const context = await setup();
  try {
    for (const target of ["../outside.txt", ".env", "node_modules/pkg/index.js", "src/../../outside.ts"]) {
      await assert.rejects(
        () => context.service.stage("WEB", [target], true)
      );
    }
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("requiere cambios preparados para crear un commit y valida mensajes", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () => context.service.commit("WEB", "Commit vacío", true),
      /No hay cambios preparados/
    );
    await assert.rejects(
      () => context.service.commit("WEB", "mensaje\nmalicioso", true),
      /una sola línea/
    );
    const commits = await context.service.log("WEB", 5);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].subject, "Initial commit");
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("rechaza proyectos que no son repositorios Git", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-not-git-"));
  try {
    const projects = {
      get: async () => ({ id: "EMPTY", name: "Empty", directory, description: "", created: "2026-11-21" })
    };
    const service = new GitService(projects);
    await assert.rejects(() => service.inspect("EMPTY"), /not a git repository|repositorio Git/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
