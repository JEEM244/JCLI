import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TaskStore } from "../dist/tasks/taskStore.js";

test("crea, lista y mueve tareas entre archivos TXT", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-test-"));
  try {
    const store = new TaskStore(directory);
    await store.initialize();
    await store.add({
      id: "TEST-001",
      title: "Prueba",
      description: "Tarea de prueba",
      priority: "media",
      created: "2026-11-20"
    });
    assert.equal((await store.list("pendientes")).length, 1);
    await store.move("TEST-001", "completadas");
    assert.equal((await store.list("pendientes")).length, 0);
    assert.equal((await store.list("completadas"))[0].id, "TEST-001");
    const content = await readFile(path.join(directory, "completadas.txt"), "utf8");
    assert.match(content, /TEST-001/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("edita, busca y conserva la asociación a un proyecto en TXT", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-project-task-"));
  try {
    const store = new TaskStore(directory);
    await store.initialize();
    await store.add({
      id: "WEB-002",
      title: "Crear panel",
      description: "Panel de administración",
      priority: "alta",
      created: "2026-11-20",
      projectId: "WEB"
    });
    await store.update("WEB-002", { title: "Crear panel web", description: "Panel actualizado" });
    const found = await store.search("panel actualizado");
    assert.equal(found.length, 1);
    assert.equal(found[0].projectId, "WEB");
    const txt = await readFile(path.join(directory, "pendientes.txt"), "utf8");
    assert.match(txt, /project=WEB/);
    assert.match(txt, /title=Crear panel web/);
    await store.update("WEB-002", { projectId: undefined });
    assert.doesNotMatch(await readFile(path.join(directory, "pendientes.txt"), "utf8"), /project=WEB/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rechaza una tarea cuyo estado no coincide con el archivo TXT", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-invalid-task-"));
  try {
    const store = new TaskStore(directory);
    await store.initialize();
    await writeFile(path.join(directory, "pendientes.txt"),
      "[TASK]\nid=BAD-001\ntitle=Error\ndescription=\nstatus=completadas\npriority=media\ncreated=2026-11-20\n[/TASK]", "utf8");
    await assert.rejects(() => store.list("pendientes"), /declara status=completadas/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rechaza bloques TXT sin cerrar", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-unclosed-task-"));
  try {
    const store = new TaskStore(directory);
    await store.initialize();
    await writeFile(path.join(directory, "pendientes.txt"), "[TASK]\\nid=OPEN-001\\ntitle=Abierta", "utf8");
    await assert.rejects(() => store.list("pendientes"), /bloques \\[TASK\\] sin cerrar/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
