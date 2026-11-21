import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectToolchain } from "../dist/dev/toolchainDetector.js";
import { CommandRunner } from "../dist/dev/commandRunner.js";

test("ejecuta un script de build confirmado y no hereda claves API", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-runner-node-"));
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "DO_NOT_LEAK_THIS_TEST_KEY";
  try {
    await writeFile(path.join(directory, "package.json"), JSON.stringify({
      scripts: {
        build: "node -e \"console.log('BUILD_OK'); console.log(process.env.OPENAI_API_KEY || 'NO_API_KEY')\""
      }
    }), "utf8");
    const toolchain = await detectToolchain("NODE", directory);
    const command = toolchain.commands.find((item) => item.action === "build");
    assert.ok(command);
    const result = await new CommandRunner().run("NODE", directory, command);
    assert.equal(result.status, "success", result.stderr);
    assert.match(result.stdout, /BUILD_OK/);
    assert.match(result.stdout, /NO_API_KEY/);
    assert.doesNotMatch(result.stdout, /DO_NOT_LEAK_THIS_TEST_KEY/);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("bloquea argumentos alterados aunque se invoque directamente al runner", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-runner-block-"));
  try {
    const result = await new CommandRunner().run("NODE", directory, {
      tool: "npm",
      action: "build",
      executable: "npm",
      args: ["run", "build", "&&", "whoami"],
      display: "npm run build"
    });
    assert.equal(result.status, "failure");
    assert.match(result.stderr, /comando npm/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
