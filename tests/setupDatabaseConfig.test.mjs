import test from "node:test";
import assert from "node:assert/strict";
import { inspectConnectionString } from "../dist/setup/projectSetup.js";

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
