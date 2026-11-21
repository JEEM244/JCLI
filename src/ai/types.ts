export type ProviderId = "openai" | "gemini" | "deepseek" | "anthropic";

export interface AISettings {
  maxRequestsPerDay: number;
  maxInputCharacters: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
}

export interface AIUsageEntry {
  timestamp: string;
  provider: ProviderId;
  model: string;
  result: "success" | "error";
  inputCharacters: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
}
