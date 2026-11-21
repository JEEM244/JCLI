import { readFile } from "node:fs/promises";
import { ProviderClient, type ProviderConfig, type AIResponse } from "./providerClient.js";
import { AIUsageStore } from "./usageStore.js";
import type { AISettings, ProviderId } from "./types.js";

interface ProviderFile {
  limits: AISettings;
  providers: ProviderConfig[];
}

export interface AIAskOptions {
  systemPrompt?: string;
  model?: string;
  maxOutputTokens?: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadConfig(): Promise<ProviderFile> {
  const raw = await readFile(new URL("../../config/providers.json", import.meta.url), "utf8");
  const config = JSON.parse(raw) as ProviderFile;
  if (!Array.isArray(config.providers) || !config.limits) {
    throw new Error("La configuración de proveedores está incompleta.");
  }
  return {
    ...config,
    limits: {
      maxRequestsPerDay: positiveInteger(process.env.JCLI_MAX_REQUESTS_PER_DAY, config.limits.maxRequestsPerDay),
      maxInputCharacters: positiveInteger(process.env.JCLI_MAX_INPUT_CHARS, config.limits.maxInputCharacters),
      maxOutputTokens: positiveInteger(process.env.JCLI_MAX_OUTPUT_TOKENS, config.limits.maxOutputTokens),
      requestTimeoutMs: positiveInteger(process.env.JCLI_REQUEST_TIMEOUT_MS, config.limits.requestTimeoutMs)
    }
  };
}

export class AIService {
  constructor(
    private readonly client = new ProviderClient(),
    private readonly usage = new AIUsageStore()
  ) {}

  private async provider(id: string): Promise<{ provider: ProviderConfig; key: string; settings: AISettings }> {
    const config = await loadConfig();
    const provider = config.providers.find((item) => item.id === id);
    if (!provider || !["openai", "gemini", "deepseek", "anthropic"].includes(id)) {
      throw new Error("Proveedor desconocido: " + id + ".");
    }
    if (!provider.enabled) throw new Error("El proveedor " + provider.name + " está deshabilitado.");
    const key = process.env[provider.env];
    if (!key?.trim()) throw new Error("Falta " + provider.env + ". Configura tu archivo .env local.");
    return { provider, key, settings: config.limits };
  }

  async models(id: string): Promise<string[]> {
    const { provider, key, settings } = await this.provider(id);
    return this.client.listModels(provider, key, settings.requestTimeoutMs);
  }

  async ask(id: string, prompt: string, options: AIAskOptions = {}): Promise<AIResponse> {
    if (process.env.JCLI_ENABLE_API_CALLS !== "true") {
      throw new Error("Las llamadas de generación están desactivadas. Revisa los posibles cargos y, con autorización de tu madre, padre o tutor, activa JCLI_ENABLE_API_CALLS=true en .env.");
    }
    const { provider, key, settings } = await this.provider(id);
    const systemPrompt = options.systemPrompt?.trim() ?? "";
    if (!prompt.trim()) throw new Error("Escribe una instrucción para la IA.");
    if (prompt.length + systemPrompt.length > settings.maxInputCharacters) {
      throw new Error("La instrucción y el contexto superan el límite local de " + settings.maxInputCharacters + " caracteres.");
    }

    const totals = await this.usage.totalsToday();
    if (totals.requests >= settings.maxRequestsPerDay) {
      throw new Error("Se alcanzó el límite local de " + settings.maxRequestsPerDay +
        " solicitudes al día (UTC). Puedes cambiarlo en .env.");
    }

    const model = options.model?.trim() || process.env[provider.modelEnv]?.trim() || provider.defaultModel;
    const requestedTokens = options.maxOutputTokens ?? settings.maxOutputTokens;
    if (!Number.isSafeInteger(requestedTokens) || requestedTokens < 1) {
      throw new Error("El límite de salida solicitado no es válido.");
    }
    const maxOutputTokens = Math.min(requestedTokens, settings.maxOutputTokens);
    const started = Date.now();
    let response: AIResponse | undefined;
    let failure: unknown;

    try {
      response = await this.client.generate(
        provider, key, prompt, model, maxOutputTokens, settings.requestTimeoutMs, systemPrompt
      );
      return response;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      await this.usage.record({
        timestamp: new Date().toISOString(),
        provider: provider.id as ProviderId,
        model,
        result: response ? "success" : "error",
        inputCharacters: prompt.length + systemPrompt.length,
        inputTokens: response?.usage.inputTokens,
        outputTokens: response?.usage.outputTokens,
        durationMs: Date.now() - started
      }).catch((logError) => {
        if (!failure) throw new Error("La llamada terminó, pero no se pudo guardar el historial de consumo: " +
          (logError instanceof Error ? logError.message : "error de escritura"));
      });
    }
  }
}
