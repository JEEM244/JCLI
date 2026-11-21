import { readFile } from "node:fs/promises";
import type { AgentConfig, AgentDefinition } from "./types.js";

const allowedProviders = ["openai", "gemini", "deepseek", "anthropic"];

export class AgentRegistry {
  constructor(private readonly configUrl = new URL("../../config/agents.json", import.meta.url)) {}

  async load(): Promise<AgentConfig> {
    const raw = await readFile(this.configUrl, "utf8");
    const config = JSON.parse(raw) as AgentConfig;
    if (!Array.isArray(config.agents) || !config.limits) {
      throw new Error("La configuración de agentes está incompleta.");
    }

    const ids = new Set<string>();
    for (const agent of config.agents) {
      if (!agent.id || !/^[a-z0-9][a-z0-9-]{0,39}$/i.test(agent.id)) {
        throw new Error("La configuración contiene un ID de agente inválido.");
      }
      if (ids.has(agent.id.toLowerCase())) {
        throw new Error("Hay IDs de agentes duplicados: " + agent.id + ".");
      }
      ids.add(agent.id.toLowerCase());
      if (!allowedProviders.includes(agent.provider)) {
        throw new Error("Proveedor inválido en el agente " + agent.id + ".");
      }
      if (!agent.name.trim() || !agent.systemPrompt.trim() || !agent.purpose.trim()) {
        throw new Error("El agente " + agent.id + " tiene campos obligatorios vacíos.");
      }
      if (!Number.isInteger(agent.maxOutputTokens) || agent.maxOutputTokens < 1 || agent.maxOutputTokens > 512) {
        throw new Error("El límite de salida del agente " + agent.id + " debe estar entre 1 y 512.");
      }
    }

    const limits = config.limits;
    if (![limits.maxAgentsPerRun, limits.maxFilesPerRun, limits.maxFileBytes, limits.maxContextCharacters]
      .every((value) => Number.isInteger(value) && value > 0)) {
      throw new Error("Los límites de coordinación deben ser enteros positivos.");
    }
    return config;
  }

  async list(): Promise<AgentDefinition[]> {
    const config = await this.load();
    return config.agents;
  }

  async get(id: string): Promise<AgentDefinition | undefined> {
    return (await this.list()).find((agent) => agent.id.toLowerCase() === id.toLowerCase());
  }
}
