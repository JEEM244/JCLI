export type TaskStatus = "pendientes" | "en_proceso" | "completadas" | "archivadas";
export type TaskPriority = "baja" | "media" | "alta" | "urgente";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  created: string;
}
