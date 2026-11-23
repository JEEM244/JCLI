import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findSSMS22Executable } from "../dist/integrations/ide/detector.js";
import { inspectSqlScript } from "../dist/integrations/ide/ssms22Integration.js";

test("localiza SSMS 22 en la ruta habitual de instalación", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-ssms22-"));
  try {
    const executable = path.join(root, "Microsoft SQL Server Management Studio 22",
      "Release", "Common7", "IDE", "Ssms.exe");
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "test executable", "utf8");
    assert.equal(findSSMS22Executable([root]), executable);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no detecta SSMS 22 si no existe el ejecutable", () => {
  assert.equal(findSSMS22Executable(["/ruta/sin/ssms"], () => false), undefined);
});

test("inspecciona metadatos de un archivo SQL dentro del proyecto", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-ssms-inspect-"));
  try {
    await mkdir(path.join(directory, "sql"), { recursive: true });
    const file = path.join(directory, "sql", "schema.sql");
    await writeFile(file, "CREATE TABLE dbo.Demo (Id int);\r\nSELECT 1;\r\n", "utf8");
    const result = await inspectSqlScript(directory, file);
    assert.equal(result.relativePath, path.join("sql", "schema.sql"));
    assert.equal(result.lineCount, 3);
    assert.ok(result.sizeBytes > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rechaza archivos SQL fuera del proyecto", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-ssms-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "jcli-ssms-outside-"));
  try {
    const file = path.join(outside, "other.sql");
    await writeFile(file, "SELECT 1;", "utf8");
    await assert.rejects(() => inspectSqlScript(directory, file), /dentro de la carpeta del proyecto/);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("rechaza extensiones diferentes de .sql", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-ssms-extension-"));
  try {
    const file = path.join(directory, "notes.txt");
    await writeFile(file, "not SQL", "utf8");
    await assert.rejects(() => inspectSqlScript(directory, file), /extensión .sql/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
