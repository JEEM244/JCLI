import type { ProviderId } from "./types.js";

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  env: string;
  modelEnv: string;
  defaultModel: string;
  endpoint: string;
  modelsEndpoint: string;
  enabled: boolean;
  apiVersion?: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface AIResponse {
  provider: ProviderId;
  model: string;
  text: string;
  usage: TokenUsage;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {};
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readUsage(provider: ProviderId, body: JsonObject): TokenUsage {
  const usage = asObject(body.usage ?? body.usageMetadata);
  if (provider === "openai") {
    return {
      inputTokens: asNumber(usage.input_tokens),
      outputTokens: asNumber(usage.output_tokens)
    };
  }
  if (provider === "gemini") {
    return {
      inputTokens: asNumber(usage.promptTokenCount),
      outputTokens: asNumber(usage.candidatesTokenCount)
    };
  }
  if (provider === "deepseek") {
    return {
      inputTokens: asNumber(usage.prompt_tokens),
      outputTokens: asNumber(usage.completion_tokens)
    };
  }
  return {
    inputTokens: asNumber(usage.input_tokens),
    outputTokens: asNumber(usage.output_tokens)
  };
}

function extractText(provider: ProviderId, body: JsonObject): string {
  if (provider === "openai") {
    const output = Array.isArray(body.output) ? body.output : [];
    const text = output.flatMap((item) => {
      const content = asObject(item).content;
      return Array.isArray(content) ? content : [];
    }).map((item) => {
      const block = asObject(item);
      return block.type === "output_text" ? getText(block.text) ?? "" : "";
    }).filter(Boolean).join("\n");
    return getText(body.output_text) ?? text;
  }

  if (provider === "gemini") {
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    return candidates.flatMap((item) => {
      const content = asObject(asObject(item).content);
      return Array.isArray(content.parts) ? content.parts : [];
    }).map((item) => getText(asObject(item).text) ?? "").filter(Boolean).join("\n");
  }

  if (provider === "deepseek") {
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const message = asObject(asObject(choices[0]).message);
    return getText(message.content) ?? "";
  }

  const content = Array.isArray(body.content) ? body.content : [];
  return content.map((item) => {
    const block = asObject(item);
    return block.type === "text" ? getText(block.text) ?? "" : "";
  }).filter(Boolean).join("\n");
}

function errorMessage(body: JsonObject, fallback: string): string {
  const error = asObject(body.error);
  return getText(error.message) ?? getText(body.message) ?? fallback;
}

export class ProviderClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private headers(provider: ProviderConfig, apiKey: string): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.id === "gemini") {
      headers["x-goog-api-key"] = apiKey;
    } else if (provider.id === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = process.env.ANTHROPIC_VERSION || provider.apiVersion || "2026-10-21";
    } else {
      headers.Authorization = "Bearer " + apiKey;
    }
    return headers;
  }

  private async request(
    url: string,
    init: RequestInit,
    apiKey: string,
    timeoutMs: number
  ): Promise<JsonObject> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error("La solicitud agotó el tiempo límite (" + timeoutMs + " ms).");
      }
      throw new Error("No se pudo conectar con el proveedor: " +
        (error instanceof Error ? error.message : "error de red"));
    }

    const raw = await response.text();
    let body: JsonObject = {};
    try {
      body = asObject(raw ? JSON.parse(raw) : {});
    } catch {
      body = {};
    }

    if (!response.ok) {
      let message = errorMessage(body, raw.slice(0, 400) || response.statusText || "Error HTTP");
      if (apiKey) message = message.split(apiKey).join("[API_KEY]");
      throw new Error("El proveedor respondió HTTP " + response.status + ": " + message.slice(0, 500));
    }
    return body;
  }

  async listModels(provider: ProviderConfig, apiKey: string, timeoutMs = 30000): Promise<string[]> {
    const body = await this.request(provider.modelsEndpoint, {
      method: "GET",
      headers: this.headers(provider, apiKey)
    }, apiKey, timeoutMs);

    const entries = Array.isArray(body.data) ? body.data :
      Array.isArray(body.models) ? body.models : [];
    return entries.map((item) => {
      const model = asObject(item);
      const name = getText(model.id) ?? getText(model.name);
      return name?.replace(/^models\//, "");
    }).filter((item): item is string => Boolean(item)).sort();
  }

  async generate(
    provider: ProviderConfig,
    apiKey: string,
    prompt: string,
    model: string,
    maxOutputTokens: number,
    timeoutMs: number,
    systemPrompt = ""
  ): Promise<AIResponse> {
    let url = provider.endpoint;
    let body: JsonObject;

    if (provider.id === "openai") {
      body = {
        model,
        input: prompt,
        max_output_tokens: maxOutputTokens,
        ...(systemPrompt ? { instructions: systemPrompt } : {})
      };
    } else if (provider.id === "gemini") {
      url = provider.endpoint.replace(/\/$/, "") + "/" + encodeURIComponent(model) + ":generateContent";
      body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens },
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {})
      };
    } else if (provider.id === "deepseek") {
      body = {
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: prompt }
        ],
        max_tokens: maxOutputTokens,
        stream: false
      };
    } else {
      body = {
        model,
        max_tokens: maxOutputTokens,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: [{ role: "user", content: prompt }]
      };
    }

    const result = await this.request(url, {
      method: "POST",
      headers: this.headers(provider, apiKey),
      body: JSON.stringify(body)
    }, apiKey, timeoutMs);

    const text = extractText(provider.id, result).trim();
    if (!text) {
      const reason = getText(asObject(result.error).message) ?? "El proveedor no devolvió texto. Puede haber aplicado un filtro o límite.";
      throw new Error(reason);
    }

    return {
      provider: provider.id,
      model: getText(result.model) ?? model,
      text,
      usage: readUsage(provider.id, result)
    };
  }
}
