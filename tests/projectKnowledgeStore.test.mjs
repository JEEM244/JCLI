import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectKnowledgeStore } from "../dist/knowledge/projectKnowledgeStore.js";

test("guarda resumen, notas y decisiones técnicas y los recupera después", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-knowledge-"));
  try {
    const store = new ProjectKnowledgeStore(directory);
    await store.setSummary("WEB", "Panel administrativo en PHP y MySQL.");
    const note = await store.addNote("WEB", "El login usa sesiones del servidor.");
    const decision = await store.addDecision(
      "WEB",
      "Persistencia",
      "Mantener MySQL en la primera versión.",
      "El proyecto ya utiliza XAMPP."
    );

    const loaded = await store.get("WEB");
    assert.equal(loaded.summary, "Panel administrativo en PHP y MySQL.");
    assert.equal(loaded.notes.length, 1);
    assert.equal(loaded.notes[0].id, note.id);
    assert.equal(loaded.decisions.length, 1);
    assert.equal(loaded.decisions[0].id, decision.id);
    assert.ok(loaded.updatedAt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("redacta secretos comunes antes de persistir la memoria", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-knowledge-redact-"));
  try {
    const store = new ProjectKnowledgeStore(directory);
    await store.addNote("WEB", "No copiar api_key=\"abcd1234567890\" ni Bearer abcdefghijklmnop123456.");
    const loaded = await store.get("WEB");
    assert.doesNotMatch(loaded.notes[0].content, /abcd1234567890/);
    assert.doesNotMatch(loaded.notes[0].content, /abcdefghijklmnop123456/);
    assert.match(loaded.notes[0].content, /SECRETO OCULTO|TOKEN OCULTO/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("limita tamaño y obliga a que los registros tengan contenido", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-knowledge-limits-"));
  try {
    const store = new ProjectKnowledgeStore(directory);
    await assert.rejects(() => store.addNote("WEB", "   "), /no puede estar vacío/);
    await assert.rejects(() => store.addNote("WEB", "x".repeat(1501)), /no puede superar 1500/);
    await assert.rejects(() => store.setSummary("WEB", "x".repeat(2001)), /no puede superar 2000/);
    await assert.rejects(() => store.addDecision("WEB", " ", "Decision"), /no puede estar vacío/);
    await assert.rejects(() => store.get("../outside"), /ID de proyecto no válido/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("elimina notas y decisiones por ID sin alterar otras entradas", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-knowledge-remove-"));
  try {
    const store = new ProjectKnowledgeStore(directory);
    const first = await store.addNote("WEB", "Primera nota.");
    const second = await store.addNote("WEB", "Segunda nota.");
    const decision = await store.addDecision("WEB", "Rutas", "Separar API y web.");
    await store.removeNote("WEB", first.id);
    await store.removeDecision("WEB", decision.id);

    const loaded = await store.get("WEB");
    assert.deepEqual(loaded.notes.map((item) => item.id), [second.id]);
    assert.equal(loaded.decisions.length, 0);
    await assert.rejects(() => store.removeNote("WEB", first.id), /No se encontró/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("guarda una instantánea de estructura sin guardar contenido de archivos", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-knowledge-scan-"));
  try {
    const store = new ProjectKnowledgeStore(directory);
    await store.saveStructure("WEB", {
      root: "C:/Users/test/project",
      filesScanned: 42,
      languages: [{ name: "TypeScript", files: 20 }, { name: "HTML", files: 10 }],
      technologies: ["Angular"],
      manifests: ["package.json"],
      gitRepository: true
    });
    const context = await store.getContext("WEB", 3000);
    assert.match(context, /TypeScript \(20\)/);
    assert.match(context, /Angular/);
    assert.match(context, /package.json/);
    assert.equal(context.includes("C:/Users/test"), false);

    const records = await readdir(directory);
    assert.equal(records.length, 1);
    const file = await readFile(path.join(directory, records[0]), "utf8");
    assert.equal(file.includes("C:/Users/test"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("produce contexto limitado con resumen, decisiones y notas recientes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-knowledge-context-"));
  try {
    const store = new ProjectKnowledgeStore(directory);
    await store.setSummary("WEB", "Aplicación para administrar solicitudes.");
    await store.addDecision("WEB", "Base de datos", "Usar MySQL.");
    await store.addNote("WEB", "La API está en src/api.");
    const context = await store.getContext("WEB", 900);
    assert.match(context, /RESUMEN DEL PROYECTO/);
    assert.match(context, /DECISIONES TÉCNICAS/);
    assert.match(context, /NOTAS DEL PROYECTO/);
    assert.ok(context.length <= 900);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
