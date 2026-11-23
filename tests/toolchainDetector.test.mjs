import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectToolchain } from "../dist/dev/toolchainDetector.js";

test("detecta scripts build/test de Node.js sin inventar comandos", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-toolchain-node-"));
  try {
    await writeFile(path.join(directory, "package.json"), JSON.stringify({
      scripts: { build: "tsc", test: "node --test" }
    }), "utf8");
    const result = await detectToolchain("NODE", directory);
    assert.deepEqual(result.detected, ["Node.js / npm"]);
    assert.deepEqual(result.commands.map((command) => command.display), ["npm run build", "npm run test"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("detecta una solución .NET dentro de una carpeta del proyecto", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-toolchain-dotnet-"));
  try {
    await mkdir(path.join(directory, "src", "App"), { recursive: true });
    await writeFile(path.join(directory, "src", "App", "App.csproj"), "<Project />", "utf8");
    await writeFile(path.join(directory, "src", "App", "App.sln"), "solution", "utf8");
    const result = await detectToolchain("DOTNET", directory);
    assert.ok(result.detected.includes(".NET / Visual Studio"));
    assert.equal(result.commands.find((item) => item.action === "build").display,
      "dotnet build src" + path.sep + "App" + path.sep + "App.sln --nologo");
    assert.equal(result.commands.find((item) => item.action === "test").display,
      "dotnet test src" + path.sep + "App" + path.sep + "App.sln --nologo");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Composer solo habilita test si existe el script, incluso en forma de arreglo", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-toolchain-php-"));
  try {
    await writeFile(path.join(directory, "composer.json"), JSON.stringify({
      scripts: { test: ["phpunit", "--colors=never"] }
    }), "utf8");
    const result = await detectToolchain("PHP", directory);
    assert.ok(result.detected.includes("PHP / Composer"));
    assert.ok(result.commands.some((item) => item.display === "composer test"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("no propone comandos para proyectos sin toolchain compatible", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-toolchain-empty-"));
  try {
    const result = await detectToolchain("EMPTY", directory);
    assert.equal(result.commands.length, 0);
    assert.ok(result.warnings.some((warning) => warning.includes("No se reconoció")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("detecta proyectos SQL SDK-style y propone solo compilación", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-toolchain-sqlsdk-"));
  try {
    await mkdir(path.join(directory, "database"), { recursive: true });
    await writeFile(path.join(directory, "database", "Catalog.sqlproj"),
      '<Project Sdk="Microsoft.Build.Sql/1.0.0"></Project>', "utf8");
    const result = await detectToolchain("SQLSDK", directory);
    assert.ok(result.detected.includes("SQL Server Database Project (.sqlproj)"));
    assert.ok(result.commands.some((item) =>
      item.action === "build" && item.display.includes("dotnet build database")
    ));
    assert.ok(!result.commands.some((item) => item.action === "test"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("no inventa dotnet build para proyectos SQL clásicos", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-toolchain-sqllegacy-"));
  try {
    await writeFile(path.join(directory, "Legacy.sqlproj"),
      '<Project ToolsVersion="4.0"><PropertyGroup><Name>Legacy</Name></PropertyGroup></Project>', "utf8");
    const result = await detectToolchain("SQLLEGACY", directory);
    assert.ok(result.detected.includes("SQL Server Database Project (.sqlproj)"));
    assert.ok(!result.commands.some((item) => item.tool === "dotnet"));
    assert.ok(result.warnings.some((warning) => warning.includes("MSBuild y SSDT")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
