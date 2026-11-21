import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AIUsageStore } from "../dist/ai/usageStore.js";

test("guarda el resultado y las métricas de una solicitud", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-ai-usage-"));
  try {
    const usage = new AIUsageStore(path.join(directory, "ai-usage.jsonl"));
    await usage.record({
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-6.2-astra",
      result: "success",
      inputCharacters: 18,
      inputTokens: 4,
      outputTokens: 8,
      durationMs: 250
    });
    const totals = await usage.totalsToday();
    assert.equal(totals.requests, 1);
    assert.equal(totals.inputTokens, 4);
    assert.equal(totals.outputTokens, 8);
    assert.equal((await usage.list(1))[0].provider, "openai");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
