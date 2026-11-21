export interface GitStatus {
  projectId: string;
  root: string;
  branch: string;
  clean: boolean;
  changes: string[];
  summary: string;
}

export interface GitCommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}
