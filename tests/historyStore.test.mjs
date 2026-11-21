import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HistoryStore } from "../dist/history/historyStore.js";

test("registra y devuelve las operaciones más recientes primero", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-history-"));
  try {
    const history = new HistoryStore(path.join(directory, "events.jsonl"));
    await history.record("task.created", "TASK-001", "Primera tarea");
    await history.record("task.status_changed", "TASK-001", "Movida a completadas");
    const entries = await history.list(1);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, "task.status_changed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
