import test from "node:test";
import assert from "node:assert/strict";
import { buildToolRequirements, parseWindowsDatabaseServices } from "../dist/setup/projectSetup.js";

test("asigna toolchains por proyecto y respeta el lockfile", () => {
  const report={packageDirectories:["."],manifests:["package.json","pnpm-lock.yaml"],dotnetProjects:["App.csproj"],composerDirectories:["backend"],requirements:["Python"],kinds:["ASP.NET Core","Go","Rust","Java"],databaseEngines:["SQL Server","MySQL","PostgreSQL"]};
  const ids=buildToolRequirements(report,"win32").map(item=>item.id);
  for(const expected of ["node","pnpm","dotnet","php","composer","python","go","cargo","rustc","java","javac","sqlcmd","sqlpackage","mysql-client","psql"]) assert.ok(ids.includes(expected),"Falta "+expected);
  assert.ok(!ids.includes("npm"),"No debe exigir npm cuando existe pnpm-lock.yaml");
});

test("interpreta servicios SQL locales y estados", () => {
  const output=["SERVICE_NAME: MSSQLSERVER","        STATE              : 4  RUNNING","","SERVICE_NAME: MSSQL$SQLEXPRESS","        STATE              : 1  STOPPED","","SERVICE_NAME: MySQL80","        STATE              : 4  RUNNING","","SERVICE_NAME: PostgreSQL-x64-17","        STATE              : 1  STOPPED"].join("\n");
  const result=parseWindowsDatabaseServices(output,["SQL Server","MySQL","PostgreSQL"]);
  assert.equal(result.length,3);
  assert.equal(result.find(item=>item.engine==="SQL Server")?.state,"running");
  assert.equal(result.find(item=>item.engine==="MySQL")?.state,"running");
  assert.equal(result.find(item=>item.engine==="PostgreSQL")?.state,"stopped");
  assert.equal(result.find(item=>item.engine==="SQL Server")?.serviceName,"MSSQLSERVER");
});

test("la ausencia del servicio local no descarta un servidor remoto", () => {
  const result=parseWindowsDatabaseServices("",["SQL Server"]);
  assert.equal(result[0].state,"missing");
  assert.match(result[0].details,/remoto/);
});
