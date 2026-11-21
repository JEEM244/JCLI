import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
