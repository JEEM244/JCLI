import type { FilePatch } from "./types.js";

type DiffOperation = {
  kind: "same" | "remove" | "add";
  line: string;
  oldLine: number;
  newLine: number;
};

function operations(before: string[], after: string[]): DiffOperation[] {
  const width = after.length + 1;
  const matrix = new Uint32Array((before.length + 1) * width);

  for (let oldIndex = before.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = after.length - 1; newIndex >= 0; newIndex--) {
      const cell = oldIndex * width + newIndex;
      matrix[cell] = before[oldIndex] === after[newIndex]
        ? matrix[(oldIndex + 1) * width + newIndex + 1] + 1
        : Math.max(
          matrix[(oldIndex + 1) * width + newIndex],
          matrix[oldIndex * width + newIndex + 1]
        );
    }
  }

  const result: DiffOperation[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let oldLine = 1;
  let newLine = 1;

  while (oldIndex < before.length || newIndex < after.length) {
    if (oldIndex < before.length && newIndex < after.length &&
        before[oldIndex] === after[newIndex]) {
      result.push({ kind: "same", line: before[oldIndex], oldLine, newLine });
      oldIndex++;
      newIndex++;
      oldLine++;
      newLine++;
    } else if (oldIndex < before.length &&
        (newIndex >= after.length ||
         matrix[(oldIndex + 1) * width + newIndex] >= matrix[oldIndex * width + newIndex + 1])) {
      result.push({ kind: "remove", line: before[oldIndex], oldLine, newLine });
      oldIndex++;
      oldLine++;
    } else {
      result.push({ kind: "add", line: after[newIndex], oldLine, newLine });
      newIndex++;
      newLine++;
    }
  }
  return result;
}

export function renderPatchDiff(patch: FilePatch, context = 3): string {
  if (patch.originalContent === patch.proposedContent) return "No hay diferencias entre ambos archivos.";

  const before = patch.originalContent.split(/\r?\n/);
  const after = patch.proposedContent.split(/\r?\n/);
  if ((before.length + 1) * (after.length + 1) > 2_260_000) {
    return "La propuesta excede el límite interno de la vista de diferencias. Revisa los archivos manualmente antes de aprobar.";
  }

  const rows = operations(before, after);
  const changed = rows.map((row, index) => row.kind === "same" ? -1 : index).filter((index) => index >= 0);
  if (!changed.length) return "No hay diferencias entre ambos archivos.";

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(rows.length - 1, index + context);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous.end + 1) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }

  const output = [
    "--- " + patch.targetPath,
    "+++ " + patch.candidatePath
  ];
  let previousEnd = -1;
  for (const range of ranges) {
    if (previousEnd >= 0 && range.start > previousEnd + 1) output.push("...");
    output.push("@@ cambio cercano a línea " +
      (rows[range.start].oldLine || rows[range.start].newLine) + " @@");
    for (let index = range.start; index <= range.end; index++) {
      const row = rows[index];
      const marker = row.kind === "same" ? " " : row.kind === "remove" ? "-" : "+";
      output.push(marker + row.line);
    }
    previousEnd = range.end;
  }
  return output.join("\n");
}
