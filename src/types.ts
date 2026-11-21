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
}

export type HistoryAction =
  | "task.created"
  | "task.updated"
  | "task.status_changed"
  | "task.project_linked"
  | "task.project_unlinked"
  | "project.created";

export interface HistoryEntry {
  id: string;
  timestamp: string;
  action: HistoryAction;
  entityId: string;
  summary: string;
}
