import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PatchService } from "../dist/patches/patchService.js";
import { PatchStore } from "../dist/patches/patchStore.js";
import { HistoryStore } from "../dist/history/historyStore.js";

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-patch-"));
  const projectDirectory = path.join(directory, "project");
  await mkdir(path.join(projectDirectory, "src"), { recursive: true });
  await writeFile(path.join(projectDirectory, "src/app.ts"), "const value = 1;\nconsole.log(value);\n", "utf8");
  await writeFile(path.join(projectDirectory, "src/app.proposed.ts"), "const value = 2;\nconsole.log(value);\n", "utf8");
  const projects = {
    get: async (id) => id === "WEB"
      ? { id, name: "Web", directory: projectDirectory, description: "", created: "2026-11-20" }
      : undefined
  };
  const store = new PatchStore(path.join(directory, "data/patches"));
  const history = new HistoryStore(path.join(directory, "data/history.jsonl"));
  return {
    directory,
    projectDirectory,
    service: new PatchService(projects, store, history),
    history
  };
}

test("crea, revisa, aprueba, aplica y revierte una propuesta con respaldo", async () => {
  const context = await setup();
  try {
    const patch = await context.service.draft("WEB", "src/app.ts", "src/app.proposed.ts");
    assert.equal(patch.status, "draft");
    assert.notEqual(patch.originalHash, patch.proposedHash);
    await assert.rejects(() => context.service.apply(patch.id, true), /debe estar aprobada/);
    await assert.rejects(() => context.service.apply(patch.id, false), /--confirm/);

    await context.service.approve(patch.id);
    const applied = await context.service.apply(patch.id, true);
    assert.equal(applied.status, "applied");
    assert.ok(applied.backupPath);
    assert.match(await readFile(path.join(context.projectDirectory, "src/app.ts"), "utf8"), /value = 2/);

    const backup = await context.service.rollback(patch.id, true);
    assert.equal(backup.status, "rolled_back");
    assert.match(await readFile(path.join(context.projectDirectory, "src/app.ts"), "utf8"), /value = 1/);

    const events = await context.history.list(20);
    assert.deepEqual(events.map((item) => item.action).sort(), [
      "patch.applied", "patch.approved", "patch.drafted", "patch.rolled_back"
    ].sort());
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("bloquea la aplicación si el archivo original cambió después del borrador", async () => {
  const context = await setup();
  try {
    const patch = await context.service.draft("WEB", "src/app.ts", "src/app.proposed.ts");
    await context.service.approve(patch.id);
    await writeFile(path.join(context.projectDirectory, "src/app.ts"), "const value = 99;\n", "utf8");
    await assert.rejects(
      () => context.service.apply(patch.id, true),
      /cambió desde que se creó/
    );
    assert.match(await readFile(path.join(context.projectDirectory, "src/app.ts"), "utf8"), /value = 99/);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("bloquea rutas externas, carpetas protegidas y archivos de credenciales", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () => context.service.draft("WEB", "../outside.txt", "src/app.proposed.ts"),
      /relativa|segmentos no permitidos/
    );
    await assert.rejects(
      () => context.service.draft("WEB", ".env", "src/app.proposed.ts"),
      /bloquea archivos/
    );
    await assert.rejects(
      () => context.service.draft("WEB", "node_modules/pkg/index.js", "src/app.proposed.ts"),
      /carpeta protegida/
    );
    await assert.rejects(
      () => context.service.draft("WEB", "src/app.ts", "src/app.ts"),
      /archivos distintos|No hay cambios/
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("bloquea la reversión si el archivo tuvo cambios posteriores a la aplicación", async () => {
  const context = await setup();
  try {
    const patch = await context.service.draft("WEB", "src/app.ts", "src/app.proposed.ts");
    await context.service.approve(patch.id);
    await context.service.apply(patch.id, true);
    await writeFile(path.join(context.projectDirectory, "src/app.ts"), "const value = 3;\n", "utf8");
    await assert.rejects(
      () => context.service.rollback(patch.id, true),
      /cambió después de aplicar/
    );
    assert.match(await readFile(path.join(context.projectDirectory, "src/app.ts"), "utf8"), /value = 3/);
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("solo permite archivos UTF-8 pequeños y existentes", async () => {
  const context = await setup();
  try {
    await writeFile(path.join(context.projectDirectory, "src/binary.bin"), Buffer.from([0, 1, 2]));
    await assert.rejects(
      () => context.service.draft("WEB", "src/binary.bin", "src/app.proposed.ts"),
      /binarios/
    );
    await assert.rejects(
      () => context.service.draft("WEB", "src/missing.ts", "src/app.proposed.ts"),
      /ENOENT/
    );
  } finally {
    await rm(context.directory, { recursive: true, force: true });
  }
});
