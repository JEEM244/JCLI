import test from "node:test";
import assert from "node:assert/strict";
import { inspectConnectionString, inspectProjectForSetup, inspectDatabaseConfiguration } from "../dist/setup/projectSetup.js";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("resume una conexión SQL Server sin exponer credenciales", () => {
  const profile=inspectConnectionString("DefaultConnection","appsettings.json",
    "Server=\${DB_HOST};Database=\${DB_NAME};User Id=admin;Password=super-secret;");
  assert.equal(profile.serverConfigured,true);
  assert.equal(profile.databaseConfigured,true);
  assert.equal(profile.authentication,"credentials");
  assert.deepEqual(profile.environmentVariables,["DB_HOST","DB_NAME"]);
  assert.equal(JSON.stringify(profile).includes("super-secret"),false);
  assert.equal(JSON.stringify(profile).includes("admin"),false);
});

test("reconoce autenticación integrada aunque los valores tengan espacios", () => {
  const profile=inspectConnectionString("Local","appsettings.Development.json",
    "Data Source=(localdb)\\MSSQLLocalDB;Initial Catalog=School;Integrated Security=True;TrustServerCertificate=True");
  assert.equal(profile.serverConfigured,true);
  assert.equal(profile.databaseConfigured,true);
  assert.equal(profile.authentication,"integrated");
  assert.deepEqual(profile.environmentVariables,[]);
});

test("no inventa datos ausentes ni confunde contraseña con tipo de autenticación", () => {
  const profile=inspectConnectionString("Empty","appsettings.json","Encrypt=True;Password=hidden;");
  assert.equal(profile.serverConfigured,false);
  assert.equal(profile.databaseConfigured,false);
  assert.equal(profile.authentication,"unspecified");
  assert.equal(JSON.stringify(profile).includes("hidden"),false);
});


test("reconoce MySQL mediante servidor, puerto y usuario sin revelar valores", () => {
  const profile = inspectConnectionString("MySql", "appsettings.Production.json",
    "Server=\${MYSQL_HOST};Port=3306;Database=\${MYSQL_DB};Uid=\${MYSQL_USER};Pwd=\${MYSQL_PASSWORD};");
  assert.equal(profile.serverConfigured, true);
  assert.equal(profile.portConfigured, true);
  assert.equal(profile.databaseConfigured, true);
  assert.equal(profile.authentication, "credentials");
  assert.deepEqual(profile.environmentVariables, ["MYSQL_DB", "MYSQL_HOST", "MYSQL_PASSWORD", "MYSQL_USER"]);
  assert.equal(JSON.stringify(profile).includes("3306"), false);
  assert.equal(JSON.stringify(profile).includes("MYSQL_HOST"), true);
  assert.equal(JSON.stringify(profile).includes("MYSQL_PASSWORD"), true);
});

test("reconoce PostgreSQL mediante Host, Port, Dbname y Username", () => {
  const profile = inspectConnectionString("Postgres", "appsettings.json",
    "Host=%PG_HOST%;Port=5432;Database=%PG_DB%;Username=%PG_USER%;Password=%PG_PASSWORD%;");
  assert.equal(profile.serverConfigured, true);
  assert.equal(profile.portConfigured, true);
  assert.equal(profile.databaseConfigured, true);
  assert.equal(profile.authentication, "credentials");
  assert.deepEqual(profile.environmentVariables, ["PG_DB", "PG_HOST", "PG_PASSWORD", "PG_USER"]);
});

test("advierte cuando una cadena mezcla Windows Auth y usuario explícito", () => {
  const profile = inspectConnectionString("Mixed", "appsettings.json",
    "Server=(local);Database=School;Integrated Security=True;User Id=student;");
  assert.equal(profile.authentication, "conflicting");
});

test("no marca credenciales si solo aparece una contraseña sin usuario", () => {
  const profile = inspectConnectionString("Partial", "appsettings.json",
    "Host=db.example;Port=5432;Database=app;Password=hidden;");
  assert.equal(profile.serverConfigured, true);
  assert.equal(profile.portConfigured, true);
  assert.equal(profile.databaseConfigured, true);
  assert.equal(profile.authentication, "unspecified");
});


test("inspecta perfiles MySQL y PostgreSQL desde appsettings sin revelar valores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-connection-inventory-"));
  try {
    await writeFile(path.join(root, "appsettings.json"), JSON.stringify({
      ConnectionStrings: {
        MySql: "Server=db.internal;Port=3306;Database=store;Uid=app;Pwd=secret;",
        Postgres: "Host=pg.internal;Port=5432;Database=school;Username=app;Password=secret;"
      }
    }));
    const inspection = await inspectProjectForSetup(root);
    const profiles = await inspectDatabaseConfiguration(inspection);
    assert.deepEqual(profiles.map((item) => item.name), ["MySql", "Postgres"]);
    assert.ok(profiles.every((item) => item.serverConfigured && item.portConfigured && item.databaseConfigured));
    assert.ok(profiles.every((item) => item.authentication === "credentials"));
    assert.equal(JSON.stringify(profiles).includes("db.internal"), false);
    assert.equal(JSON.stringify(profiles).includes("secret"), false);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("no lee appsettings enlazado a un archivo fuera del proyecto", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-connection-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "jcli-connection-outside-"));
  try {
    await writeFile(path.join(outside, "external.json"), JSON.stringify({
      ConnectionStrings: { External: "Host=private.host;Port=5432;Database=private;Username=user;" }
    }));
    try {
      await symlink(path.join(outside, "external.json"), path.join(root, "appsettings.json"), "file");
    } catch {
      return;
    }
    const profiles = await inspectDatabaseConfiguration({
      root, connectionFiles: ["appsettings.json"]
    });
    assert.deepEqual(profiles, []);
  } finally {
    await rm(root, { recursive:true, force:true });
    await rm(outside, { recursive:true, force:true });
  }
});
