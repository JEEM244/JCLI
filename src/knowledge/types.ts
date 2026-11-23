export interface ProjectKnowledgeNote {
  id: string;
  content: string;
  createdAt: string;
}

export interface ProjectKnowledgeDecision {
  id: string;
  title: string;
  decision: string;
  context?: string;
  createdAt: string;
}

export interface ProjectStructureSnapshot {
  generatedAt: string;
  filesScanned: number;
  languages: Array<{ name: string; files: number }>;
  technologies: string[];
  manifests: string[];
  gitRepository: boolean;
}

export interface ProjectKnowledge {
  projectId: string;
  updatedAt: string;
  summary?: string;
  notes: ProjectKnowledgeNote[];
  decisions: ProjectKnowledgeDecision[];
  structure?: ProjectStructureSnapshot;
}
