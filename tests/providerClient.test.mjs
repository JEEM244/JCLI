import test from "node:test";
import assert from "node:assert/strict";
import { ProviderClient } from "../dist/ai/providerClient.js";

const configs = {
  openai: {
    id: "openai", name: "OpenAI", env: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-6.2-astra", endpoint: "https://api.openai.com/v1/responses",
    modelsEndpoint: "https://api.openai.com/v1/models", enabled: true
  },
  gemini: {
    id: "gemini", name: "Gemini", env: "GEMINI_API_KEY", modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-3.8-flash", endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    modelsEndpoint: "https://generativelanguage.googleapis.com/v1beta/models", enabled: true
  },
  deepseek: {
    id: "deepseek", name: "DeepSeek", env: "DEEPSEEK_API_KEY", modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-flash", endpoint: "https://api.deepseek.com/chat/completions",
    modelsEndpoint: "https://api.deepseek.com/models", enabled: true
  },
  anthropic: {
    id: "anthropic", name: "Anthropic", env: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-5-5", endpoint: "https://api.anthropic.com/v1/messages",
    modelsEndpoint: "https://api.anthropic.com/v1/models", apiVersion: "2026-10-21", enabled: true
  }
};

test("OpenAI Responses API envía texto y extrae el resultado", async () => {
  const client = new ProviderClient(async (url, init) => {
    assert.equal(url, configs.openai.endpoint);
    assert.equal(init.headers.Authorization, "Bearer test-secret");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "gpt-6.2-astra");
    assert.equal(body.input, "Responde OK");
    return new Response(JSON.stringify({
      model: "gpt-6.2-astra",
      output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
      usage: { input_tokens: 3, output_tokens: 1 }
    }), { status: 200 });
  });
  const result = await client.generate(configs.openai, "test-secret", "Responde OK", "gpt-6.2-astra", 128, 5000);
  assert.equal(result.text, "OK");
  assert.equal(result.usage.inputTokens, 3);
  assert.equal(result.usage.outputTokens, 1);
});

test("Gemini usa x-goog-api-key y su formato generateContent", async () => {
  const client = new ProviderClient(async (url, init) => {
    assert.equal(url, configs.gemini.endpoint + "/gemini-3.8-flash:generateContent");
    assert.equal(init.headers["x-goog-api-key"], "gemini-secret");
    const body = JSON.parse(init.body);
    assert.equal(body.contents[0].parts[0].text, "Hola");
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "¡Hola!" }] } }],
      usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4 }
    }), { status: 200 });
  });
  const result = await client.generate(configs.gemini, "gemini-secret", "Hola", "gemini-3.8-flash", 128, 5000);
  assert.equal(result.text, "¡Hola!");
  assert.equal(result.usage.outputTokens, 4);
});

test("DeepSeek usa Chat Completions y extrae choices", async () => {
  const client = new ProviderClient(async (url, init) => {
    assert.equal(url, configs.deepseek.endpoint);
    assert.equal(init.headers.Authorization, "Bearer deepseek-secret");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "deepseek-flash");
    assert.equal(body.stream, false);
    return new Response(JSON.stringify({
      model: "deepseek-flash",
      choices: [{ message: { content: "Respuesta DeepSeek" } }],
      usage: { prompt_tokens: 5, completion_tokens: 6 }
    }), { status: 200 });
  });
  const result = await client.generate(configs.deepseek, "deepseek-secret", "Prueba", "deepseek-flash", 128, 5000);
  assert.equal(result.text, "Respuesta DeepSeek");
  assert.equal(result.usage.inputTokens, 5);
});

test("Claude Messages API usa x-api-key y extrae bloques de texto", async () => {
  const client = new ProviderClient(async (url, init) => {
    assert.equal(url, configs.anthropic.endpoint);
    assert.equal(init.headers["x-api-key"], "claude-secret");
    assert.equal(init.headers["anthropic-version"], "2026-10-21");
    const body = JSON.parse(init.body);
    assert.equal(body.max_tokens, 128);
    return new Response(JSON.stringify({
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: "Respuesta Claude" }],
      usage: { input_tokens: 8, output_tokens: 9 }
    }), { status: 200 });
  });
  const result = await client.generate(configs.anthropic, "claude-secret", "Prueba", "claude-sonnet-5-5", 128, 5000);
  assert.equal(result.text, "Respuesta Claude");
  assert.equal(result.usage.outputTokens, 9);
});

test("la lista de modelos devuelve IDs sin exponer la clave", async () => {
  const client = new ProviderClient(async (url, init) => {
    assert.equal(url, configs.deepseek.modelsEndpoint);
    assert.equal(init.headers.Authorization, "Bearer private-key");
    return new Response(JSON.stringify({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] }), { status: 200 });
  });
  assert.deepEqual(await client.listModels(configs.deepseek, "private-key"), ["deepseek-flash", "deepseek-v4-pro"]);
});

test("los errores HTTP ocultan la clave si aparece en el mensaje", async () => {
  const client = new ProviderClient(async () =>
    new Response(JSON.stringify({ error: { message: "Rejected private-key" } }), { status: 401 })
  );
  await assert.rejects(
    () => client.generate(configs.openai, "private-key", "hello", "gpt-6.2-astra", 128, 5000),
    (error) => error.message.includes("[API_KEY]") && !error.message.includes("private-key")
  );
});

test("envía instrucciones de sistema con el formato correcto en cada proveedor", async () => {
  const cases = [
    {
      provider: configs.openai,
      key: "openai-secret",
      assertBody: (body) => assert.equal(body.instructions, "Solo revisa el código.")
    },
    {
      provider: configs.gemini,
      key: "gemini-secret",
      assertBody: (body) => assert.equal(body.systemInstruction.parts[0].text, "Solo revisa el código.")
    },
    {
      provider: configs.deepseek,
      key: "deepseek-secret",
      assertBody: (body) => assert.deepEqual(body.messages.map((message) => message.role), ["system", "user"])
    },
    {
      provider: configs.anthropic,
      key: "claude-secret",
      assertBody: (body) => assert.equal(body.system, "Solo revisa el código.")
    }
  ];

  for (const entry of cases) {
    const client = new ProviderClient(async (_url, init) => {
      const body = JSON.parse(init.body);
      entry.assertBody(body);
      if (entry.provider.id === "openai") {
        return new Response(JSON.stringify({ output_text: "OK", model: "mock" }), { status: 200 });
      }
      if (entry.provider.id === "gemini") {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }), { status: 200 });
      }
      if (entry.provider.id === "deepseek") {
        return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: [{ type: "text", text: "OK" }] }), { status: 200 });
    });
    const result = await client.generate(
      entry.provider, entry.key, "Revisa", "mock-model", 64, 5000, "Solo revisa el código."
    );
    assert.equal(result.text, "OK");
  }
});
