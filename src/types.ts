export type TaskStatus = "pendientes" | "en_proceso" | "completadas" | "archivadas";
export type TaskPriority = "baja" | "media" | "alta" | "urgente";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  created: string;
  projectId?: string;
  agentIds?: string[];
}

export type HistoryAction =
  | "task.created"
  | "task.updated"
  | "task.status_changed"
  | "task.project_linked"
  | "task.project_unlinked"
  | "task.agents_assigned"
  | "project.created"
  | "team.run_completed"
  | "team.run_reviewed";

export interface HistoryEntry {
  id: string;
  timestamp: string;
  action: HistoryAction;
  entityId: string;
  summary: string;
}
