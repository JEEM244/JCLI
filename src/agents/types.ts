export type AgentProviderId = "openai" | "gemini" | "deepseek" | "anthropic";

export interface AgentDefinition {
  id: string;
  name: string;
  provider: AgentProviderId;
  purpose: string;
  systemPrompt: string;
  enabled: boolean;
  maxOutputTokens: number;
}

export interface AgentLimits {
  maxAgentsPerRun: number;
  maxFilesPerRun: number;
  maxFileBytes: number;
  maxContextCharacters: number;
}

export interface AgentConfig {
  limits: AgentLimits;
  agents: AgentDefinition[];
}

export interface ProjectFileContext {
  path: string;
  content: string;
}

export interface TeamAgentResult {
  agentId: string;
  agentName: string;
  provider: AgentProviderId;
  model?: string;
  status: "success" | "error";
  output?: string;
  error?: string;
  durationMs: number;
}

export interface TeamRun {
  id: string;
  taskId: string;
  projectId?: string;
  createdAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "partial" | "failed";
  files: string[];
  agents: TeamAgentResult[];
  decision?: "accepted" | "rejected";
  decisionAt?: string;
}

export interface TeamPlan {
  taskId: string;
  taskTitle: string;
  projectName?: string;
  agents: AgentDefinition[];
  files: string[];
  estimatedRequests: number;
  memorySummary?: boolean;
  memoryNotes?: number;
  memoryDecisions?: number;
  memoryStructure?: boolean;
}
