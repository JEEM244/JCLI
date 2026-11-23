import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectProjectForSetup } from "../dist/setup/projectSetup.js";
import { executeDatabaseConnectionTest, READ_ONLY_PROBE_QUERY } from "../dist/setup/databaseConnectionTest.js";

async function fixture(contents) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-db-probe-"));
  await writeFile(path.join(root, "appsettings.json"), JSON.stringify({
    ConnectionStrings: contents
  }), "utf8");
  return { root, report: await inspectProjectForSetup(root), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("prueba SQL Server con autenticación integrada y consulta fija de solo lectura", async () => {
  const data = await fixture({
    DefaultConnection: "Server=\${DB_SERVER};Database=\${DB_NAME};Integrated Security=True;Encrypt=True;"
  });
  try {
    let captured;
    const result = await executeDatabaseConnectionTest(data.report, "DefaultConnection", true, {
      platform: "win32",
      env: { DB_SERVER: "localhost", DB_NAME: "School" },
      resolveExecutable: async () => "sqlcmd.exe",
      runner: async (executable, args, timeout, env) => {
        captured = { executable, args, timeout, env };
        return { exitCode: 0, timedOut: false };
      }
    });
    assert.equal(result.status, "success");
    assert.equal(result.file, "appsettings.json");
    assert.equal(captured.executable, "sqlcmd.exe");
    assert.ok(captured.args.includes("-E"));
    assert.ok(captured.args.includes("-X1"));
    assert.ok(captured.args.includes(READ_ONLY_PROBE_QUERY));
    assert.ok(captured.args.includes("localhost"));
    assert.ok(captured.args.includes("School"));
    assert.ok(!captured.args.includes("-U"));
    assert.ok(!captured.args.includes("-P"));
  } finally {
    await data.cleanup();
  }
});

test("no intenta conectar si falta una variable de entorno", async () => {
  const data = await fixture({
    DefaultConnection: "Server=\${DB_SERVER};Database=School;Integrated Security=True;"
  });
  try {
    let called = false;
    await assert.rejects(
      executeDatabaseConnectionTest(data.report, "DefaultConnection", true, {
        platform: "win32", env: {}, resolveExecutable: async () => "sqlcmd.exe",
        runner: async () => { called = true; return { exitCode: 0, timedOut: false }; }
      }),
      /Faltan variables de entorno.*DB_SERVER/
    );
    assert.equal(called, false);
  } finally {
    await data.cleanup();
  }
});

test("rechaza autenticación SQL y nunca pasa usuario o contraseña al cliente", async () => {
  const data = await fixture({
    DefaultConnection: "Server=localhost;Database=School;User Id=admin;Password=not-for-logs;"
  });
  try {
    let called = false;
    await assert.rejects(
      executeDatabaseConnectionTest(data.report, "DefaultConnection", true, {
        platform: "win32", env: {}, resolveExecutable: async () => "sqlcmd.exe",
        runner: async () => { called = true; return { exitCode: 0, timedOut: false }; }
      }),
      /solo admite autenticación integrada/
    );
    assert.equal(called, false);
  } finally {
    await data.cleanup();
  }
});

test("rechaza campos de credenciales incluso si la cadena también declara Windows Auth", async () => {
  const data = await fixture({
    DefaultConnection: "Server=localhost;Database=School;Integrated Security=True;Password=hidden;"
  });
  try {
    await assert.rejects(
      executeDatabaseConnectionTest(data.report, "DefaultConnection", true, {
        platform: "win32", env: {}, resolveExecutable: async () => "sqlcmd.exe",
        runner: async () => ({ exitCode: 0, timedOut: false })
      }),
      /contiene campos de usuario o contraseña/
    );
  } finally {
    await data.cleanup();
  }
});

test("requiere nombre explícito cuando existen perfiles duplicados", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-db-probe-"));
  try {
    await writeFile(path.join(root, "appsettings.json"), JSON.stringify({
      ConnectionStrings: { Main: "Server=localhost;Database=A;Integrated Security=True;" }
    }), "utf8");
    await writeFile(path.join(root, "appsettings.Development.json"), JSON.stringify({
      ConnectionStrings: { Main: "Server=localhost;Database=B;Integrated Security=True;" }
    }), "utf8");
    const report = await inspectProjectForSetup(root);
    await assert.rejects(
      executeDatabaseConnectionTest(report, "Main", true, { platform: "win32" }),
      /ARCHIVO::NOMBRE/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("informa timeout y no expone salida del proceso", async () => {
  const data = await fixture({
    Main: "Server=localhost;Database=School;Trusted_Connection=Yes;"
  });
  try {
    const result = await executeDatabaseConnectionTest(data.report, "Main", true, {
      platform: "win32", env: {}, resolveExecutable: async () => "sqlcmd.exe",
      runner: async () => ({ exitCode: null, timedOut: true })
    });
    assert.equal(result.status, "timeout");
    assert.equal(Object.hasOwn(result, "stdout"), false);
    assert.equal(Object.hasOwn(result, "stderr"), false);
  } finally {
    await data.cleanup();
  }
});

test("no permite ejecutar una prueba sin confirmación o fuera de Windows", async () => {
  const data = await fixture({
    Main: "Server=localhost;Database=School;Trusted_Connection=True;"
  });
  try {
    await assert.rejects(
      executeDatabaseConnectionTest(data.report, "Main", false, { platform: "win32" }),
      /requiere confirmación/
    );
    await assert.rejects(
      executeDatabaseConnectionTest(data.report, "Main", true, { platform: "linux" }),
      /solo está disponible en Windows/
    );
  } finally {
    await data.cleanup();
  }
});


async function xmlFixture(filename, contents) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-db-xml-"));
  await writeFile(path.join(root, filename), contents, "utf8");
  return { root, report: await inspectProjectForSetup(root), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("db-test lee perfiles XML de Web.config y App.config", async () => {
  for (const filename of ["Web.config", "App.config"]) {
    const data = await xmlFixture(filename, `<?xml version="1.0"?>
<configuration>
  <appSettings>
    <add key="Ignored" value="Server=elsewhere;Database=Other;" />
  </appSettings>
  <connectionStrings>
    <!-- <add name="Commented" connectionString="Server=invalid;Database=bad;Integrated Security=True;" /> -->
    <add name="DefaultConnection"
      connectionString="Server=localhost;Database=School;Integrated Security=True;Application Name=Web &amp; API;"
      providerName="System.Data.SqlClient" />
  </connectionStrings>
</configuration>`);
    try {
      let captured;
      const result = await executeDatabaseConnectionTest(data.report, "DefaultConnection", true, {
        platform: "win32",
        env: {},
        resolveExecutable: async () => "sqlcmd.exe",
        runner: async (executable, args, timeout, env) => {
          captured = { executable, args, timeout, env };
          return { exitCode: 0, timedOut: false };
        }
      });
      assert.equal(result.status, "success");
      assert.equal(result.file, filename);
      assert.ok(captured.args.includes("localhost"));
      assert.ok(captured.args.includes("School"));
      assert.ok(captured.args.includes(READ_ONLY_PROBE_QUERY));
      assert.ok(captured.args.includes("-E"));
      assert.ok(!captured.args.some((arg) => /Web & API|elsewhere|Commented/.test(arg)));
    } finally {
      await data.cleanup();
    }
  }
});

test("permite seleccionar un perfil XML duplicado usando ARCHIVO::NOMBRE", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-db-xml-duplicate-"));
  try {
    await writeFile(path.join(root, "appsettings.json"), JSON.stringify({
      ConnectionStrings: { Main: "Server=json-host;Database=JsonDb;Integrated Security=True;" }
    }), "utf8");
    await writeFile(path.join(root, "Web.config"), `<configuration>
  <connectionStrings>
    <add name="Main" connectionString="Server=xml-host;Database=XmlDb;Integrated Security=True;" />
  </connectionStrings>
</configuration>`, "utf8");
    const report = await inspectProjectForSetup(root);
    const result = await executeDatabaseConnectionTest(report, "Web.config::Main", true, {
      platform: "win32",
      env: {},
      resolveExecutable: async () => "sqlcmd.exe",
      runner: async (_executable, args) => {
        assert.ok(args.includes("xml-host"));
        assert.ok(args.includes("XmlDb"));
        return { exitCode: 0, timedOut: false };
      }
    });
    assert.equal(result.file, "Web.config");
    await assert.rejects(
      executeDatabaseConnectionTest(report, "Main", true, {
        platform: "win32",
        env: {},
        resolveExecutable: async () => "sqlcmd.exe",
        runner: async () => ({ exitCode: 0, timedOut: false })
      }),
      /ARCHIVO::NOMBRE/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
