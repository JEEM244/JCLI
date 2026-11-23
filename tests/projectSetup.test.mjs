import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectProjectForSetup, createSetupPlan, executeSetupPlan } from "../dist/setup/projectSetup.js";

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
