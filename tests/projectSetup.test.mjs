import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectProjectForSetup, createSetupPlan, executeSetupPlan, isHashLockedPythonRequirements, runSetupCommand, exportSetupReport } from "../dist/setup/projectSetup.js";

test("analiza ASP.NET MVC y SQL Server sin exponer valores de conexión", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-mvc-"));
  try {
    await mkdir(path.join(root, "Migrations"), { recursive: true });
    await writeFile(path.join(root, "MVCConexion.slnx"), "<Solution />");
    await writeFile(path.join(root, "MVCConexion.csproj"), [
      '<Project Sdk="Microsoft.NET.Sdk.Web">',
      '<ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="10.0.0" /></ItemGroup>',
      "</Project>"
    ].join(""));
    await writeFile(path.join(root, "appsettings.Development.json"), JSON.stringify({
      ConnectionStrings: { conexion: "Server=localhost;Database=Catalogo;Password=Secret42;" }
    }));
    await writeFile(path.join(root, "Migrations", "Initial.cs"), "namespace Demo;");
    await writeFile(path.join(root, "database.sql"), "CREATE TABLE Demo (Id int);");
    await writeFile(path.join(root, "backup.bak"), "backup");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "mvc-ui" }));
    await writeFile(path.join(root, "package-lock.json"), JSON.stringify({ name: "mvc-ui", lockfileVersion: 3 }));
    const report = await inspectProjectForSetup(root);
    assert.ok(report.kinds.includes("ASP.NET Core"));
    assert.ok(report.databaseEngines.includes("SQL Server"));
    assert.deepEqual(report.connectionNames, ["conexion"]);
    assert.ok(report.solutions.includes("MVCConexion.slnx"));
    assert.ok(report.sqlScripts.includes("database.sql"));
    assert.ok(report.migrations.includes("Migrations/Initial.cs"));
    assert.ok(report.backups.includes("backup.bak"));
    assert.ok(!JSON.stringify(report).includes("Secret42"));
    const plan = createSetupPlan(report);
    assert.ok(plan.actions.some((item) => item.id === "dotnet-restore"));
    assert.ok(plan.actions.some((item) => item.command === "npm ci --ignore-scripts"));
    assert.ok(plan.manualSteps.some((item) => item.includes("Base de datos")));
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("detecta Laravel y requiere composer.lock antes de restaurar", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-php-"));
  try {
    await writeFile(path.join(root, "composer.json"), JSON.stringify({ require: { "laravel/framework": "^12.0" } }));
    let report = await inspectProjectForSetup(root);
    assert.ok(report.kinds.includes("Laravel"));
    assert.equal(createSetupPlan(report).actions.length, 0);
    await writeFile(path.join(root, "composer.lock"), "{}");
    report = await inspectProjectForSetup(root);
    assert.ok(createSetupPlan(report).actions.some((item) => item.command.includes("--no-scripts --no-plugins")));
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("rechaza rutas que no son carpetas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-file-"));
  const file = path.join(root, "readme.txt");
  try {
    await writeFile(file, "texto");
    await assert.rejects(inspectProjectForSetup(file), /no es una carpeta/);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("executeSetupPlan requiere confirmación y omite acciones manuales", async () => {
  const plan = {
    inspection: { root: "C:/demo", name: "demo" },
    actions: [
      { id:"restore", title:"Restaurar", executable:"dotnet", args:["restore"], cwd:"C:/demo", command:"dotnet restore", canRun:true },
      { id:"manual", title:"Manual", executable:"sqlcmd", args:[], cwd:"C:/demo", command:"sqlcmd", canRun:false }
    ],
    manualSteps: []
  };
  let calls = 0;
  const runner = async () => { calls++; return { status:"success", exitCode:0, durationMs:10, stdout:"ok", stderr:"" }; };
  await assert.rejects(executeSetupPlan(plan, false, runner), /confirmación explícita/);
  assert.equal(calls, 0);
  const results = await executeSetupPlan(plan, true, runner);
  assert.equal(calls, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "success");
});


test("detecta ASP.NET Framework y SQL SSDT clásico para el diagnóstico de componentes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-classic-"));
  try {
    await writeFile(path.join(root, "LegacyWeb.csproj"), [
      '<Project ToolsVersion="15.0">',
      '<PropertyGroup><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup>',
      '<ItemGroup><Reference Include="System.Web" /></ItemGroup>',
      '</Project>'
    ].join(""));
    await writeFile(path.join(root, "LegacyDatabase.sqlproj"), '<Project ToolsVersion="4.0"><PropertyGroup><DSP>Microsoft.Data.Tools.Schema.Sql.Sql160DatabaseSchemaProvider</DSP></PropertyGroup></Project>');
    const report = await inspectProjectForSetup(root);
    assert.ok(report.kinds.includes("ASP.NET Framework"));
    assert.ok(report.kinds.includes(".NET Framework 4.8"));
    assert.ok(report.kinds.includes("SQL Database Project (SSDT clásico)"));
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("reconoce SQL Database Project SDK sin exigir SSDT clásico", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-sql-sdk-"));
  try {
    await writeFile(path.join(root, "ModernDatabase.sqlproj"), '<Project Sdk="Microsoft.Build.Sql/1.0.0"><PropertyGroup /></Project>');
    const report = await inspectProjectForSetup(root);
    assert.ok(report.kinds.includes("SQL Database Project SDK"));
    assert.ok(!report.kinds.includes("SQL Database Project (SSDT clásico)"));
  } finally { await rm(root, { recursive:true, force:true }); }
});


test("solo marca como instalables las dependencias Python fijadas con hash SHA-256", () => {
  const hash = "a".repeat(64);
  assert.equal(isHashLockedPythonRequirements("flask==3.0.0 --hash=sha256:" + hash), true);
  assert.equal(isHashLockedPythonRequirements("flask>=3.0"), false);
  assert.equal(isHashLockedPythonRequirements("flask==3.0.0"), false);
  assert.equal(isHashLockedPythonRequirements("--index-url https://example.invalid/simple\nflask==3.0.0 --hash=sha256:" + hash), false);
});

test("planifica entorno Python y solo instala requisitos hash-locked", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-python-"));
  try {
    await writeFile(path.join(root, "requirements.txt"),
      "flask==3.0.0 --hash=sha256:" + "a".repeat(64) + "\n");
    const report = await inspectProjectForSetup(root);
    assert.deepEqual(report.pythonHashLockedRequirements, ["requirements.txt"]);
    const plan = createSetupPlan(report);
    const venv = plan.actions.find((item) => item.id.startsWith("python-venv-"));
    const install = plan.actions.find((item) => item.id.startsWith("python-install-"));
    assert.ok(venv);
    assert.ok(install);
    assert.ok(install.args.includes("--require-hashes"));
    assert.ok(install.args.includes("--only-binary=:all:"));
    assert.ok(!install.args.includes("--no-build-isolation"));
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("no sobrescribe un entorno Python existente y conserva instalación manual sin hashes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-python-existing-"));
  try {
    await mkdir(path.join(root, ".venv"), { recursive: true });
    await writeFile(path.join(root, "requirements.txt"), "flask>=3.0\n");
    const report = await inspectProjectForSetup(root);
    assert.deepEqual(report.pythonEnvironments, [".venv"]);
    const plan = createSetupPlan(report);
    assert.ok(!plan.actions.some((item) => item.id.startsWith("python-venv-")));
    assert.ok(!plan.actions.some((item) => item.id.startsWith("python-install-")));
    assert.ok(plan.manualSteps.some((item) => item.includes("hashes")));
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("restaura módulos Go y Rust solo cuando existe lockfile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-compiled-"));
  try {
    await mkdir(path.join(root, "goapp"), { recursive: true });
    await mkdir(path.join(root, "rustapp"), { recursive: true });
    await writeFile(path.join(root, "goapp", "go.mod"), "module example.test/app\n\ngo 1.22\n");
    await writeFile(path.join(root, "goapp", "go.sum"), "example.test/dependency v1.0.0 h1:abc=\n");
    await writeFile(path.join(root, "rustapp", "Cargo.toml"), '[package]\nname="demo"\nversion="0.1.0"\n');
    await writeFile(path.join(root, "rustapp", "Cargo.lock"), 'version = 3\n');
    const report = await inspectProjectForSetup(root);
    const plan = createSetupPlan(report);
    assert.ok(plan.actions.some((item) => item.command === "go mod download"));
    assert.ok(plan.actions.some((item) => item.command.includes("cargo fetch --locked")));
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("detiene el plan después de la primera restauración fallida", async () => {
  const plan = {
    inspection: { root: "C:/demo", name: "demo" },
    actions: [
      { id:"one", title:"One", executable:"first", args:[], cwd:"C:/demo", command:"first", canRun:true },
      { id:"two", title:"Two", executable:"second", args:[], cwd:"C:/demo", command:"second", canRun:true }
    ],
    manualSteps: []
  };
  const calls = [];
  const results = await executeSetupPlan(plan, true, async (executable) => {
    calls.push(executable);
    return { status:executable === "first" ? "failed" : "success", exitCode:1, durationMs:1, stdout:"", stderr:"" };
  });
  assert.deepEqual(calls, ["first"]);
  assert.equal(results.length, 1);
});


test("respeta packageManager y se detiene ante lockfiles contradictorios", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-manager-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      name: "web-app", packageManager: "pnpm@9.15.4"
    }));
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const report = await inspectProjectForSetup(root);
    const plan = createSetupPlan(report);
    assert.equal(report.packageManagerHints["."], "pnpm@9");
    assert.ok(plan.actions.some((item) => item.command === "pnpm install --frozen-lockfile --ignore-scripts"));
    assert.ok(!plan.actions.some((item) => item.command === "npm ci --ignore-scripts"));
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("no elige gestor automáticamente cuando existen varios lockfiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-lock-conflict-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "ambiguous" }));
    await writeFile(path.join(root, "package-lock.json"), "{}");
    await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const report = await inspectProjectForSetup(root);
    const plan = createSetupPlan(report);
    assert.equal(plan.actions.filter((item) => ["npm","pnpm","yarn"].some((manager) => item.id.startsWith(manager + "-install-"))).length, 0);
    assert.ok(plan.manualSteps.some((step) => step.includes("varios lockfiles")));
    assert.ok(report.warnings.some((warning) => warning.includes("varios lockfiles")));
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("distingue Yarn Berry y desactiva sus builds al restaurar", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-yarn-berry-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "berry", packageManager: "yarn@4.5.0" }));
    await writeFile(path.join(root, "yarn.lock"), "__metadata:\n  version: 8\n");
    const report = await inspectProjectForSetup(root);
    assert.ok(report.yarnBerryDirectories.includes("."));
    const action = createSetupPlan(report).actions.find((item) => item.id.startsWith("yarn-install-"));
    assert.ok(action);
    assert.deepEqual(action.args, ["install", "--immutable", "--mode=skip-builds"]);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("rechaza packageManager no compatible aunque exista un lockfile", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-manager-unsupported-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "web", packageManager: "bun@1.2.0" }));
    await writeFile(path.join(root, "bun.lockb"), "binary");
    await writeFile(path.join(root, "package-lock.json"), "{}");
    const report = await inspectProjectForSetup(root);
    const plan = createSetupPlan(report);
    assert.ok(!plan.actions.some((item) => item.id.startsWith("npm-install-")));
    assert.ok(plan.manualSteps.some((step) => step.includes("gestor no compatible")));
  } finally { await rm(root, { recursive:true, force:true }); }
});


test("setup all ofrece un preflight completo sin modificar el proyecto por defecto", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-all-"));
  const originalLog = console.log;
  const output = [];
  try {
    await writeFile(path.join(root, "README.txt"), "proyecto de prueba");
    console.log = (...items) => output.push(items.join(" "));
    await runSetupCommand("all", [root]);
    const rendered = output.join("\n");
    assert.ok(rendered.includes("No se ejecutó ninguna acción"));
    assert.ok(rendered.includes("No se encontraron cadenas de conexión .NET"));
  } finally {
    console.log = originalLog;
    await rm(root, { recursive:true, force:true });
  }
});

test("setup all exige confirmación válida antes de aceptar ejecución", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-all-args-"));
  try {
    await assert.rejects(runSetupCommand("all", [root, "--force"]), /Uso: troc setup all/);
    await assert.rejects(runSetupCommand("all", [root, "--confirm", "extra"]), /Uso: troc setup all/);
  } finally { await rm(root, { recursive:true, force:true }); }
});


test("exporta un informe JSON sin rutas absolutas ni valores de conexión", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-report-"));
  const fixedDate = new Date("2026-11-22T12:00:00.000Z");
  try {
    await writeFile(path.join(root, "appsettings.json"), JSON.stringify({
      ConnectionStrings: {
        Default: "Server=localhost;Database=PrivateDb;User Id=student;Password=Secret42;Passwordless=\${DB_SECRET}"
      }
    }));
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "demo" }));
    await writeFile(path.join(root, "package-lock.json"), "{}");
    const inspection = await inspectProjectForSetup(root);
    const doctor = {
      inspection,
      tools: [{ id: "node", name: "Node.js", required: true, installed: true, executable: "C:\\\\Users\\\\private\\\\node.exe", version: "22.0.0", note: "Runtime" }],
      ides: [{ name: "Visual Studio Code", installed: true, executable: "C:\\\\Users\\\\private\\\\Code.exe", details: "Instalación localizada." }],
      databaseServices: [{ engine: "SQL Server", serviceName: "MSSQL$SQLEXPRESS", state: "running", details: "MSSQL$SQLEXPRESS (running)" }],
      missingRequired: [],
      visualStudioComponents: []
    };
    const connections = await (await import("../dist/setup/projectSetup.js")).inspectDatabaseConfiguration(inspection);
    const plan = createSetupPlan(inspection);
    const destination = await exportSetupReport(inspection, doctor, connections, plan, fixedDate);
    const { readFile: readExport } = await import("node:fs/promises");
    const content = await readExport(destination, "utf8");
    const parsed = JSON.parse(content);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.generatedAt, fixedDate.toISOString());
    assert.equal(parsed.privacy.absolutePathsIncluded, false);
    assert.equal(parsed.privacy.executablePathsIncluded, false);
    assert.equal(parsed.privacy.connectionStringValuesIncluded, false);
    assert.equal(parsed.privacy.credentialsIncluded, false);
    assert.equal(parsed.connections[0].authentication, "sql-login");
    assert.ok(content.includes("DB_SECRET"));
    for (const secret of [root, "C:\\\\Users\\\\private", "localhost", "PrivateDb", "Secret42", "student", "MSSQL$SQLEXPRESS"]) {
      assert.ok(!content.includes(secret), "El informe no debe contener: " + secret);
    }
    const second = await exportSetupReport(inspection, doctor, connections, plan, fixedDate);
    assert.notEqual(second, destination);
    assert.ok(second.endsWith("-1.json"));
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("no exporta informes a través de una carpeta .troc que sale del proyecto", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-report-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "jcli-setup-report-outside-"));
  try {
    await writeFile(path.join(root, "README.txt"), "project");
    const inspection = await inspectProjectForSetup(root);
    const doctor = { inspection, tools: [], ides: [], databaseServices: [], missingRequired: [], visualStudioComponents: [] };
    const plan = createSetupPlan(inspection);
    const connections = [];
    const { symlink } = await import("node:fs/promises");
    try {
      await symlink(outside, path.join(root, ".troc"), "junction");
    } catch {
      // Some runners may not grant junction creation; skip this platform-specific branch.
      return;
    }
    await assert.rejects(exportSetupReport(inspection, doctor, connections, plan), /debe permanecer dentro del proyecto/);
  } finally {
    await rm(root, { recursive:true, force:true });
    await rm(outside, { recursive:true, force:true });
  }
});
