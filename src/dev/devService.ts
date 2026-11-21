import { lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectStore } from "../projects/projectStore.js";
import { HistoryStore } from "../history/historyStore.js";
import { detectToolchain, getCommand } from "./toolchainDetector.js";
import { CommandRunner } from "./commandRunner.js";
import { DevRunStore } from "./runStore.js";
import type { DevAction, DevRun, ProjectToolchain } from "./types.js";

export class DevService {
  constructor(
    private readonly projects = new ProjectStore(),
    private readonly runner = new CommandRunner(),
    private readonly runs = new DevRunStore(),
    private readonly history = new HistoryStore()
  ) {}

  async inspect(projectId: string): Promise<ProjectToolchain> {
    const project = await this.projects.get(projectId);
    if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
    return detectToolchain(project.id, project.directory);
  }

  async configureVSCodeTasks(projectId: string, confirmed: boolean): Promise<string> {
    if (!confirmed) throw new Error("La creación requiere --confirm.");
    const toolchain = await this.inspect(projectId);
    if (!toolchain.commands.length) {
      throw new Error("No se detectaron comandos build/test para configurar en VS Code.");
    }

    const vscodeDirectory = path.join(toolchain.directory, ".vscode");
    await mkdir(vscodeDirectory, { recursive: true });
    const directoryInfo = await lstat(vscodeDirectory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new Error("La ruta .vscode no es una carpeta local segura.");
    }

    const tasksPath = path.join(vscodeDirectory, "tasks.json");
    const tasks = toolchain.commands.map((command, index) => ({
      label: "JCLI: " + command.action.toUpperCase() + " — " + command.display,
      type: "process",
      command: command.executable,
      args: command.args,
      options: { cwd: "${workspaceFolder}" },
      group: {
        kind: command.action,
        isDefault: index === toolchain.commands.findIndex((item) => item.action === command.action)
      },
      problemMatcher: [],
      presentation: { reveal: "always", panel: "shared" }
    }));

    const content = JSON.stringify({ version: "2.0.0", tasks }, null, 2) + "\n";
    try {
      await writeFile(tasksPath, content, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Ya existe .vscode/tasks.json. JCLI no lo sobrescribirá; integra las tareas manualmente.");
      }
      throw error;
    }
    return tasksPath;
  }

  async run(projectId: string, action: DevAction, confirmed: boolean): Promise<DevRun[]> {
    if (!confirmed) {
      throw new Error("La ejecución requiere --confirm. Revisa primero troc dev plan " + projectId + " " + action + ".");
    }
    const project = await this.projects.get(projectId);
    if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
    const toolchain = await detectToolchain(project.id, project.directory);
    const commands = getCommand(toolchain, action);
    if (!commands.length) throw new Error("No hay un comando " + action + " compatible detectado para este proyecto.");

    const results: DevRun[] = [];
    for (const command of commands) {
      const result = await this.runner.run(project.id, project.directory, command);
      await this.runs.save(result);
      await this.history.record("dev.command_finished", result.id,
        command.display + " terminó con estado " + result.status + " en el proyecto " + project.id);
      results.push(result);
    }
    return results;
  }

  async getRun(id: string): Promise<DevRun | undefined> {
    return this.runs.get(id);
  }
}
