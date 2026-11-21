export type DevAction = "build" | "test";
export type DevStatus = "success" | "failure" | "timeout";

export interface DevCommand {
  tool: "npm" | "dotnet" | "composer" | "pytest" | "go" | "cargo";
  action: DevAction;
  executable: string;
  args: string[];
  display: string;
  note: string;
}

export interface ProjectToolchain {
  projectId: string;
  directory: string;
  detected: string[];
  commands: DevCommand[];
  warnings: string[];
}

export interface DevRun {
  id: string;
  projectId: string;
  action: DevAction;
  tool: DevCommand["tool"];
  command: string;
  status: DevStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}
