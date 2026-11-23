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
  | "team.run_reviewed"
  | "dev.command_finished"
  | "patch.drafted"
  | "patch.approved"
  | "patch.rejected"
  | "patch.applied"
  | "patch.rolled_back"
  | "git.staged"
  | "git.unstaged"
  | "git.committed"
  | "git.branch_created"
  | "git.branch_switched"
  | "github.pr_created"
  | "github.issue_created"
  | "github.issue_linked"
  | "github.issue_unlinked"
  | "memory.summary_updated"
  | "memory.note_added"
  | "memory.note_removed"
  | "memory.decision_added"
  | "memory.decision_removed"
  | "memory.structure_scanned";

export interface HistoryEntry {
  id: string;
  timestamp: string;
  action: HistoryAction;
  entityId: string;
  summary: string;
}
