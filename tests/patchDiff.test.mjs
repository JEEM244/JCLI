import test from "node:test";
import assert from "node:assert/strict";
import { renderPatchDiff } from "../dist/patches/patchDiff.js";

test("muestra líneas agregadas y eliminadas y oculta bloques sin cambios", () => {
  const patch = {
    targetPath: "src/app.ts",
    candidatePath: "src/app.proposed.ts",
    originalContent: "linea 1\nlinea 2\nvalor = 1\nlinea 4\nlinea 5\nlinea 6\nlinea 7\n",
    proposedContent: "linea 1\nlinea 2\nvalor = 2\nlinea 4\nlinea 5\nlinea 6\nlinea 7\n"
  };
  const diff = renderPatchDiff(patch, 1);
  assert.match(diff, /--- src\/app\.ts/);
  assert.match(diff, /\+\+\+ src\/app\.proposed\.ts/);
  assert.match(diff, /-valor = 1/);
  assert.match(diff, /\+valor = 2/);
});

test("identifica propuestas sin diferencias", () => {
  const patch = {
    targetPath: "a.txt",
    candidatePath: "b.txt",
    originalContent: "igual\n",
    proposedContent: "igual\n"
  };
  assert.equal(renderPatchDiff(patch), "No hay diferencias entre ambos archivos.");
});
