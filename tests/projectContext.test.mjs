import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectContextLoader } from "../dist/agents/projectContext.js";

const limits = {
  maxAgentsPerRun: 3,
  maxFilesPerRun: 2,
  maxFileBytes: 200,
  maxContextCharacters: 100
};

test("lee solo archivos seleccionados dentro del proyecto", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-context-"));
  try {
    await mkdir(path.join(directory, "src"));
    await writeFile(path.join(directory, "README.md"), "Contexto del proyecto", "utf8");
    await writeFile(path.join(directory, "src", "main.ts"), "export const ready = true;", "utf8");
    const loader = new ProjectContextLoader(limits);
    const files = await loader.load(directory, ["README.md", "src/main.ts"]);
    assert.equal(files.length, 2);
    assert.equal(files[0].path, "README.md");
    assert.match(files[1].content, /ready/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bloquea secretos, rutas externas y carpetas de dependencias", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-context-block-"));
  try {
    await mkdir(path.join(directory, "node_modules"));
    await writeFile(path.join(directory, ".env"), "TOKEN=do-not-send", "utf8");
    await writeFile(path.join(directory, "node_modules", "pkg.js"), "module", "utf8");
    const loader = new ProjectContextLoader(limits);
    await assert.rejects(() => loader.load(directory, [".env"]), /protegido/);
    await assert.rejects(() => loader.load(directory, ["node_modules/pkg.js"]), /protegido/);
    await assert.rejects(() => loader.load(directory, ["../outside.txt"]), /sale de la carpeta/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aplica límites de cantidad, tamaño y contexto", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-context-limits-"));
  try {
    await writeFile(path.join(directory, "large.txt"), "x".repeat(201), "utf8");
    const loader = new ProjectContextLoader(limits);
    await assert.rejects(() => loader.load(directory, ["large.txt"]), /supera el límite/);
    await assert.rejects(() => loader.load(directory, ["a", "b", "c"]), /Máximo de archivos/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
