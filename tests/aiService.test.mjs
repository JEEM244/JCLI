import test from "node:test";
import assert from "node:assert/strict";
import { AIService } from "../dist/ai/aiService.js";

test("no envía solicitudes de generación mientras el opt-in está desactivado", async () => {
  const previous = process.env.JCLI_ENABLE_API_CALLS;
  delete process.env.JCLI_ENABLE_API_CALLS;
  try {
    const service = new AIService();
    await assert.rejects(
      () => service.ask("openai", "Prueba"),
      /JCLI_ENABLE_API_CALLS=true/
    );
  } finally {
    if (previous === undefined) delete process.env.JCLI_ENABLE_API_CALLS;
    else process.env.JCLI_ENABLE_API_CALLS = previous;
  }
});
