import test from "node:test";
import assert from "node:assert/strict";
import { inspectConnectionString } from "../dist/setup/projectSetup.js";

test("resume una conexión SQL Server sin exponer credenciales", () => {
  const profile=inspectConnectionString("DefaultConnection","appsettings.json",
    "Server=\${DB_HOST};Database=\${DB_NAME};User Id=admin;Password=super-secret;");
  assert.equal(profile.serverConfigured,true);
  assert.equal(profile.databaseConfigured,true);
  assert.equal(profile.authentication,"sql-login");
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
