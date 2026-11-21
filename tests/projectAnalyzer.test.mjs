import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeProject } from "../dist/projects/projectAnalyzer.js";

test("detecta lenguajes y tecnologías sin recorrer node_modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jcli-project-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "fake"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      dependencies: { "@angular/core": "^22.0.0" },
      devDependencies: { typescript: "^5.0.0" }
    }));
    await writeFile(path.join(root, "src", "main.ts"), "const app: string = 'ok';");
    await writeFile(path.join(root, "src", "index.html"), "<main></main>");
    await writeFile(path.join(root, "node_modules", "fake", "ignored.js"), "ignored");
    await mkdir(path.join(root, ".git"));
    const result = await analyzeProject(root);
    assert.equal(result.gitRepository, true);
    assert.equal(result.filesScanned, 3);
    assert.deepEqual(result.languages.map((item) => item.name).sort(), ["HTML", "JSON", "TypeScript"]);
    assert.ok(result.technologies.includes("Angular"));
    assert.ok(!result.languages.some((item) => item.name === "JavaScript"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
