import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { TaskStore } from "./tasks/taskStore.js";
import { ProjectStore } from "./projects/projectStore.js";
import { HistoryStore } from "./history/historyStore.js";
import { AIService } from "./ai/aiService.js";
import { AIUsageStore } from "./ai/usageStore.js";
import { AgentRegistry } from "./agents/agentRegistry.js";
import { TeamRunStore } from "./agents/runStore.js";
import { TeamCoordinator } from "./agents/teamCoordinator.js";
import { DevService } from "./dev/devService.js";
import { DevRunStore } from "./dev/runStore.js";
import { PatchService } from "./patches/patchService.js";
import { PatchStore } from "./patches/patchStore.js";
import { renderPatchDiff } from "./patches/patchDiff.js";
import { GitService } from "./git/gitService.js";
import { GitHubClient } from "./github/githubClient.js";
import { GitHubService } from "./github/githubService.js";
import { GitHubIssueLinkStore } from "./github/issueLinkStore.js";
import { ProjectKnowledgeStore } from "./knowledge/projectKnowledgeStore.js";
import { analyzeProject } from "./projects/projectAnalyzer.js";
import { inspectGit } from "./projects/gitInspector.js";
import { detectVSCode, detectVisualStudio2026, detectSSMS22 } from "./integrations/ide/detector.js";
import { inspectSqlScript } from "./integrations/ide/ssms22Integration.js";
import { runSetupCommand } from "./setup/projectSetup.js";
import type { Task, TaskPriority, TaskStatus } from "./types.js";

const store = new TaskStore();
const projects = new ProjectStore();
const history = new HistoryStore();
const ai = new AIService();
const aiUsage = new AIUsageStore();
const agentRegistry = new AgentRegistry();
const teamRuns = new TeamRunStore();
const knowledge = new ProjectKnowledgeStore();
const team = new TeamCoordinator(store, projects, ai, agentRegistry, teamRuns, history, knowledge);
const devRuns = new DevRunStore();
const dev = new DevService(projects, undefined, devRuns, history);
const patchStore = new PatchStore();
const patchService = new PatchService(projects, patchStore, history);
const gitService = new GitService(projects, history);
const githubClient = new GitHubClient();
const githubLinks = new GitHubIssueLinkStore();
const github = new GitHubService(projects, store, githubClient, githubLinks, history);
const statuses: TaskStatus[] = ["pendientes", "en_proceso", "completadas", "archivadas"];
const priorities: TaskPriority[] = ["baja", "media", "alta", "urgente"];

function help(): void {
  console.log([
    "JCLI — Centro de control local",
    "Comando: troc",
    "",
    "Uso:",
    "  troc init",
    "  troc tasks list [estado] [--project ID] [--priority nivel] [--search texto]",
    "  troc tasks add",
    "  troc tasks show <ID>",
    "  troc tasks search <texto>",
    "  troc tasks edit <ID>",
    "  troc tasks link <ID_TAREA> <ID_PROYECTO>",
    "  troc tasks unlink <ID_TAREA>",
    "  troc tasks agents <ID_TAREA> <agente1,agente2>",
    "  troc tasks done <ID>",
    "  troc tasks move <ID> <estado>",
    "  troc project list",
    "  troc project add",
    "  troc project open <ID>",
    "  troc project analyze <ID>",
    "  troc project git <ID>",
    "  troc setup all <RUTA> [--confirm]",
    "  troc setup verify <RUTA>",
    "  troc setup vsconfig <RUTA> --confirm",
    "  troc setup inspect <RUTA>",
    "  troc setup plan <RUTA>",
    "  troc setup run <RUTA> --confirm",
    "  troc setup report <RUTA> [--json]",
    "  troc setup doctor <RUTA>",
    "  troc setup db-config <RUTA>",
    "  troc setup db-test <RUTA> <PERFIL> --confirm",
    "  troc dev inspect <ID_PROYECTO>",
    "  troc dev plan <ID_PROYECTO> <build|test>",
    "  troc dev run <ID_PROYECTO> <build|test> --confirm",
    "  troc dev show <ID_EJECUCIÓN>",
    "  troc dev runs [límite]",
    "  troc dev vscode-tasks <ID_PROYECTO> --confirm",
    "  troc patch draft <PROYECTO> <ARCHIVO> <PROPUESTA>",
    "  troc patch show <ID>",
    "  troc patch list [limite]",
    "  troc patch approve <ID>",
    "  troc patch reject <ID>",
    "  troc patch apply <ID> --confirm",
    "  troc patch rollback <ID> --confirm",
    "  troc memory show <PROYECTO>",
    "  troc memory summary <PROYECTO> <TEXTO...>",
    "  troc memory scan <PROYECTO>",
    "  troc memory context <PROYECTO>",
    "  troc memory note add <PROYECTO> <TEXTO...>",
    "  troc memory note list <PROYECTO>",
    "  troc memory note remove <PROYECTO> <ID_NOTA>",
    "  troc memory decision add <PROYECTO> <TÍTULO> <DECISIÓN> [CONTEXTO...]",
    "  troc memory decision list <PROYECTO>",
    "  troc memory decision remove <PROYECTO> <ID_DECISIÓN>",
    "  troc git status <PROYECTO>",
    "  troc git diff <PROYECTO> [--staged] [ARCHIVO]",
    "  troc git stage <PROYECTO> <ARCHIVO...> --confirm",
    "  troc git unstage <PROYECTO> <ARCHIVO...> --confirm",
    "  troc git commit <PROYECTO> <mensaje> --confirm",
    "  troc git log <PROYECTO> [limite]",
    "  troc git branch list <PROYECTO>",
    "  troc git branch create <PROYECTO> <NOMBRE> --confirm",
    "  troc git branch switch <PROYECTO> <NOMBRE> --confirm",
    "  troc github status",
    "  troc github repo <PROYECTO>",
    "  troc github branches <PROYECTO>",
    "  troc github compare <PROYECTO> <BASE> <HEAD>",
    "  troc github prs <PROYECTO> [open|closed|all]",
    "  troc github pr show <PROYECTO> <NUMERO>",
    "  troc github pr create <PROYECTO> <BASE> <TITULO> <DESCRIPCION> --confirm",
    "  troc github issues <PROYECTO> [open|closed|all]",
    "  troc github issue show <PROYECTO> <NUMERO>",
    "  troc github issue create <PROYECTO> <TITULO> <DESCRIPCION> --confirm",
    "  troc github issue link <PROYECTO> <ID_TAREA> <NUMERO> --confirm",
    "  troc github issue unlink <PROYECTO> <ID_TAREA> --confirm",
    "  troc github issue links <PROYECTO>",
    "  troc history [limite]",
    "  troc ide vscode detect",
    "  troc ide vs2026 detect",
    "  troc ide ssms22 detect",
    "  troc ide vscode open <ID>",
    "  troc ide vs2026 open <ID>",
    "  troc ide ssms22 open <ID> [ARCHIVO.sql]",
    "  troc ide ssms22 external-tool <ID>",
    "  troc ide ssms22 inspect <ID> <ARCHIVO.sql>",
    "  troc providers list",
    "  troc providers status",
    "  troc providers test <proveedor>",
    "  troc providers models <proveedor>",
    "  troc ai ask <proveedor> <instrucción>",
    "  troc ai usage [límite]",
    "  troc team agents",
    "  troc team plan <ID_TAREA> [--file ruta]",
    "  troc team run <ID_TAREA> [--file ruta]",
    "  troc team show <ID_EJECUCIÓN>",
    "  troc team decide <ID_EJECUCIÓN> <accept|reject>",
    "",
    "Estados: " + statuses.join(", "),
    "Prioridades: " + priorities.join(", ")
  ].join("\n"));
}

function printTask(task: Task): void {
  console.log("[" + task.status + "] " + task.id + " — " + task.title);
  console.log("  Prioridad: " + task.priority);
  console.log("  Proyecto: " + (task.projectId ?? "sin asociar"));
  console.log("  Agentes: " + (task.agentIds?.join(", ") || "sin asignar"));
  if (task.description) console.log("  " + task.description);
  console.log("  Creada: " + (task.created || "sin fecha"));
}

async function addProject(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const id = (await rl.question("ID del proyecto: ")).trim();
    const name = (await rl.question("Nombre: ")).trim();
    const directoryInput = (await rl.question("Ruta completa de la carpeta: ")).trim().replace(/^"(.*)"$/, "$1");
    const description = (await rl.question("Descripción: ")).trim();
    if (!id || !name || !directoryInput) throw new Error("ID, nombre y ruta son obligatorios.");
    const directory = path.resolve(directoryInput);
    if (!existsSync(directory)) throw new Error("La carpeta indicada no existe.");
    await projects.add({
      id,
      name,
      directory,
      description,
      created: new Date().toISOString().slice(0, 10)
    });
    await history.record("project.created", id, "Proyecto registrado: " + name);
    console.log("Proyecto " + name + " registrado.");
  } finally {
    rl.close();
  }
}

async function findSolution(directory: string, depth = 0): Promise<string | undefined> {
  if (depth > 3) return undefined;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const solution = entries.find((entry) =>
    entry.isFile() && /\.(sln|slnx)$/i.test(entry.name)
  ) ?? entries.find((entry) =>
    entry.isFile() && /\.csproj$/i.test(entry.name)
  );
  if (solution) return path.join(directory, solution.name);
  for (const entry of entries) {
    if (entry.isDirectory() && ![".git", ".vs", "bin", "obj", "node_modules"].includes(entry.name)) {
      const found = await findSolution(path.join(directory, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function launch(executable: string, args: string[]): void {
  const child = spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", (error) => console.error("No se pudo iniciar el programa: " + error.message));
  child.unref();
}

async function addTask(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const id = (await rl.question("ID (ej. JCLI-002): ")).trim();
    const title = (await rl.question("Título: ")).trim();
    const description = (await rl.question("Descripción: ")).trim();
    const rawPriority = (await rl.question("Prioridad (baja/media/alta/urgente) [media]: ")).trim() || "media";
    const projectId = (await rl.question("Proyecto asociado (ID, opcional): ")).trim();
    const priority = rawPriority as TaskPriority;
    if (!priorities.includes(priority)) throw new Error("Prioridad no válida.");
    if (!id || !title) throw new Error("El ID y el título son obligatorios.");
    if (projectId && !(await projects.get(projectId))) {
      throw new Error("No existe el proyecto " + projectId + ".");
    }
    const task = await store.add({
      id,
      title,
      description,
      priority,
      created: new Date().toISOString().slice(0, 10),
      ...(projectId ? { projectId } : {})
    });
    await history.record("task.created", task.id, "Tarea creada: " + task.title);
    console.log("Tarea " + task.id + " creada.");
  } finally {
    rl.close();
  }
}

async function editTask(id: string): Promise<void> {
  const current = await store.get(id);
  if (!current) throw new Error("No se encontró la tarea " + id + ".");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.log("Deja el campo vacío para conservar el valor actual. Usa - en descripción para borrarla.");
    const titleInput = (await rl.question("Título [" + current.title + "]: ")).trim();
    const descriptionInput = (await rl.question("Descripción [" + (current.description || "vacía") + "]: ")).trim();
    const priorityInput = (await rl.question("Prioridad [" + current.priority + "]: ")).trim();
    const priority = (priorityInput || current.priority) as TaskPriority;
    if (!priorities.includes(priority)) throw new Error("Prioridad no válida.");
    const description = descriptionInput === "-" ? "" : descriptionInput || current.description;
    const updated = await store.update(id, {
      title: titleInput || current.title,
      description,
      priority
    });
    await history.record("task.updated", updated.id, "Tarea editada: " + updated.title);
    console.log("Tarea " + updated.id + " actualizada.");
  } finally {
    rl.close();
  }
}

async function listTasks(args: string[]): Promise<void> {
  let status: TaskStatus | undefined;
  let projectId: string | undefined;
  let priority: TaskPriority | undefined;
  let query: string | undefined;
  let index = 0;

  if (args[0] && !args[0].startsWith("--")) {
    if (!statuses.includes(args[0] as TaskStatus)) throw new Error("Estado no válido.");
    status = args[0] as TaskStatus;
    index = 1;
  }

  while (index < args.length) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Falta el valor para " + flag + ".");
    if (flag === "--project") projectId = value;
    else if (flag === "--priority") {
      if (!priorities.includes(value as TaskPriority)) throw new Error("Prioridad no válida.");
      priority = value as TaskPriority;
    } else if (flag === "--search") query = value;
    else throw new Error("Filtro desconocido: " + flag + ".");
    index += 2;
  }

  let tasks = await store.list(status);
  if (projectId) tasks = tasks.filter((task) => task.projectId?.toLowerCase() === projectId?.toLowerCase());
  if (priority) tasks = tasks.filter((task) => task.priority === priority);
  if (query) {
    const normalized = query.toLocaleLowerCase();
    tasks = tasks.filter((task) => [task.id, task.title, task.description]
      .some((value) => value.toLocaleLowerCase().includes(normalized)));
  }
  if (!tasks.length) return console.log("No hay tareas que coincidan con esos filtros.");
  for (const task of tasks) {
    console.log("[" + task.status + "] " + task.id + " — " + task.title +
      " (prioridad: " + task.priority + ", proyecto: " + (task.projectId ?? "ninguno") + ")");
    if (task.description) console.log("  " + task.description);
  }
}

export async function runCli(args: string[]): Promise<void> {
  const [group, action, ...rest] = args;
  if (!group || group === "help" || group === "--help" || group === "-h") return help();

  if (group === "setup") return runSetupCommand(action, rest);

  if (group === "init") {
    await store.initialize();
    console.log("JCLI inicializado. Los archivos de tareas están listos.");
    return;
  }

  if (group === "tasks") {
    if (action === "list") return listTasks(rest);
    if (action === "add") return addTask();
    if (action === "show" && rest[0]) {
      const task = await store.get(rest[0]);
      if (!task) throw new Error("No se encontró la tarea " + rest[0] + ".");
      printTask(task);
      return;
    }
    if (action === "search" && rest.length) {
      const tasks = await store.search(rest.join(" "));
      if (!tasks.length) return console.log("No se encontraron coincidencias.");
      for (const task of tasks) printTask(task);
      return;
    }
    if (action === "edit" && rest[0]) return editTask(rest[0]);
    if (action === "agents" && rest[0] && rest[1]) {
      const assignment = rest.slice(1).join("").trim();
      const requested = assignment.toLowerCase() === "none" ? [] : assignment.split(",").map((id) => id.trim()).filter(Boolean);
      const available = await agentRegistry.list();
      if (requested.length > 4) throw new Error("Solo puedes asignar hasta 4 agentes por tarea.");
      for (const id of requested) {
        const agent = available.find((item) => item.id.toLowerCase() === id.toLowerCase());
        if (!agent) throw new Error("No existe el agente " + id + ".");
        if (!agent.enabled) throw new Error("El agente " + id + " está deshabilitado.");
      }
      const updated = await store.update(rest[0], { agentIds: requested });
      await history.record("task.agents_assigned", updated.id,
        requested.length ? "Agentes asignados: " + requested.join(", ") : "Se retiraron los agentes asignados");
      console.log(requested.length
        ? "Agentes asignados a " + updated.id + ": " + requested.join(", ")
        : "Se retiró la asignación de agentes de " + updated.id + ".");
      return;
    }
    if (action === "link" && rest[0] && rest[1]) {
      const project = await projects.get(rest[1]);
      if (!project) throw new Error("No existe el proyecto " + rest[1] + ".");
      const updated = await store.update(rest[0], { projectId: project.id });
      await history.record("task.project_linked", updated.id, "Tarea asociada al proyecto " + project.id);
      console.log("Tarea " + updated.id + " asociada a " + project.name + ".");
      return;
    }
    if (action === "unlink" && rest[0]) {
      const current = await store.get(rest[0]);
      if (!current) throw new Error("No se encontró la tarea " + rest[0] + ".");
      if (!current.projectId) return console.log("La tarea no tiene proyecto asociado.");
      const updated = await store.update(rest[0], { projectId: undefined });
      await history.record("task.project_unlinked", updated.id, "Tarea desvinculada del proyecto " + current.projectId);
      console.log("Proyecto retirado de la tarea " + updated.id + ".");
      return;
    }
    if (action === "done" && rest[0]) {
      const updated = await store.move(rest[0], "completadas");
      await history.record("task.status_changed", updated.id, "Tarea marcada como completada");
      console.log("Tarea " + rest[0] + " marcada como completada.");
      return;
    }
    if (action === "move" && rest[0] && rest[1]) {
      const status = rest[1] as TaskStatus;
      if (!statuses.includes(status)) throw new Error("Estado no válido.");
      const updated = await store.move(rest[0], status);
      await history.record("task.status_changed", updated.id, "Estado cambiado a " + status);
      console.log("Tarea " + rest[0] + " movida a " + status + ".");
      return;
    }
    throw new Error("Uso de tareas no válido. Ejecuta troc help.");
  }

  if (group === "project" || group === "projects") {
    if (action === "list") {
      const items = await projects.list();
      if (!items.length) return console.log("No hay proyectos registrados. Usa troc project add.");
      for (const item of items) console.log(item.id + " — " + item.name + "\n  " + item.directory);
      return;
    }
    if (action === "add") return addProject();
    if ((action === "open" || action === "analyze" || action === "git") && rest[0]) {
      const project = await projects.get(rest[0]);
      if (!project) throw new Error("No se encontró el proyecto " + rest[0] + ".");
      if (!existsSync(project.directory)) throw new Error("La carpeta del proyecto ya no existe.");

      if (action === "open") {
        const command = process.platform === "win32" ? "explorer.exe" :
          process.platform === "darwin" ? "open" : "xdg-open";
        launch(command, [project.directory]);
        console.log("Abriendo la carpeta de " + project.name + ".");
        return;
      }
      if (action === "analyze") {
        const result = await analyzeProject(project.directory);
        console.log("\nAnálisis de " + project.name);
        console.log("Archivos revisados: " + result.filesScanned +
          (result.filesScanned >= 2500 ? " (límite alcanzado)" : ""));
        console.log("Repositorio Git: " + (result.gitRepository ? "sí" : "no detectado"));
        console.log("Lenguajes:");
        if (!result.languages.length) console.log("  No se detectaron archivos reconocidos.");
        for (const language of result.languages) console.log("  " + language.name + ": " + language.files + " archivo(s)");
        console.log("Tecnologías: " + (result.technologies.join(", ") || "sin detectar"));
        console.log("Manifiestos: " + (result.manifests.join(", ") || "ninguno"));
        return;
      }
      const git = await inspectGit(project.directory);
      console.log("Repositorio: " + project.name);
      console.log("Rama: " + git.branch);
      console.log("Estado: " + (git.clean ? "limpio" : git.changes.length + " cambio(s) detectado(s)"));
      for (const change of git.changes) console.log("  " + change);
      return;
    }
    throw new Error("Uso de proyectos no válido. Ejecuta troc help.");
  }


  if (group === "git") {
    if (action === "status" && rest.length === 1) {
      const status = await gitService.inspect(rest[0]);
      console.log("Repositorio: " + status.projectId);
      console.log("Rama: " + status.branch);
      console.log("Estado: " + status.summary);
      if (!status.changes.length) console.log("Árbol de trabajo limpio.");
      for (const change of status.changes) console.log("  " + change);
      return;
    }
    if (action === "diff" && rest.length >= 1 && rest.length <= 3) {
      const projectId = rest[0];
      const options = rest.slice(1);
      const staged = options.includes("--staged");
      const paths = options.filter((item) => item !== "--staged");
      if (paths.length > 1 || options.some((item) => item.startsWith("--") && item !== "--staged")) {
        throw new Error("Usa troc git diff <PROYECTO> [--staged] [ARCHIVO].");
      }
      const diff = await gitService.diff(projectId, staged, paths[0]);
      console.log(diff);
      return;
    }
    if (action === "stage" || action === "unstage") {
      if (rest.length < 3 || rest[rest.length - 1] !== "--confirm") {
        throw new Error("Esta operación requiere uno o más archivos y --confirm.");
      }
      const projectId = rest[0];
      const files = rest.slice(1, -1);
      const result = action === "stage"
        ? await gitService.stage(projectId, files, true)
        : await gitService.unstage(projectId, files, true);
      console.log(action === "stage" ? "Archivos preparados." : "Archivos retirados del área de preparación.");
      console.log("Comando: " + result.command);
      return;
    }
    if (action === "commit") {
      if (rest.length < 3 || rest[rest.length - 1] !== "--confirm") {
        throw new Error("Usa troc git commit <PROYECTO> <mensaje> --confirm.");
      }
      const projectId = rest[0];
      const message = rest.slice(1, -1).join(" ");
      const commit = await gitService.commit(projectId, message, true);
      console.log("Commit creado: " + commit.hash);
      console.log("Mensaje: " + commit.subject);
      console.log("Autor: " + commit.author);
      return;
    }
    if (action === "log" && rest.length >= 1 && rest.length <= 2) {
      const limit = rest[1] ? Number(rest[1]) : 10;
      if (!Number.isInteger(limit) || limit < 1) throw new Error("El límite debe ser un entero positivo.");
      const commits = await gitService.log(rest[0], limit);
      if (!commits.length) return console.log("No hay commits en este repositorio.");
      for (const commit of commits) {
        console.log(commit.hash.slice(0, 10) + " | " + commit.date + " | " + commit.subject);
      }
      return;
    }
    if (action === "branch" && rest.length >= 2) {
      const [branchAction, projectId, branchName, confirmation] = rest;
      if (branchAction === "list" && rest.length === 2) {
        const branches = await gitService.listBranches(projectId);
        if (!branches.length) return console.log("No hay ramas locales.");
        for (const branch of branches) console.log("  " + branch);
        return;
      }
      if (branchAction === "create" && branchName && rest.length === 4 && confirmation === "--confirm") {
        await gitService.createBranch(projectId, branchName, true);
        console.log("Rama creada y activada: " + branchName);
        return;
      }
      if (branchAction === "switch" && branchName && rest.length === 4 && confirmation === "--confirm") {
        await gitService.switchBranch(projectId, branchName, true);
        console.log("Rama activada: " + branchName);
        return;
      }
    }
    throw new Error("Uso de Git no válido. Ejecuta troc help.");
  }


  if (group === "github") {
    if (action === "status" && rest.length === 0) {
      console.log("Token configurado: " + (githubClient.authenticated ? "sí" : "no"));
      console.log("Escrituras habilitadas: " +
        (process.env.JCLI_ENABLE_GITHUB_WRITES === "true" ? "sí" : "no"));
      console.log("Las consultas públicas pueden funcionar sin token.");
      return;
    }
    if (action === "repo" && rest.length === 1) {
      const repository = await github.repository(rest[0]);
      console.log("Repositorio: " + repository.fullName);
      console.log("URL: " + repository.htmlUrl);
      console.log("Rama principal: " + repository.defaultBranch);
      console.log("Visibilidad: " + (repository.private ? "privado" : "público"));
      return;
    }
    if (action === "branches" && rest.length === 1) {
      const branches = await github.branches(rest[0]);
      if (!branches.length) return console.log("No se encontraron ramas remotas.");
      for (const branch of branches) {
        console.log(branch.name + " | " + branch.sha.slice(0, 10) +
          (branch.protected ? " | protegida" : ""));
      }
      return;
    }
    if (action === "compare" && rest.length === 3) {
      const comparison = await github.compare(rest[0], rest[1], rest[2]);
      console.log(rest[1] + " ... " + rest[2]);
      console.log("Estado: " + comparison.status);
      console.log("Commits adelante: " + comparison.aheadBy);
      console.log("Commits atrás: " + comparison.behindBy);
      console.log("Commits comparados: " + comparison.totalCommits);
      console.log("");
      for (const file of comparison.files) {
        console.log(file.status + " | " + file.filename +
          " | +" + file.additions + " -" + file.deletions);
      }
      return;
    }
    if (action === "prs" && rest.length >= 1 && rest.length <= 2) {
      const state = rest[1] ?? "open";
      if (!["open", "closed", "all"].includes(state)) {
        throw new Error("El filtro debe ser open, closed o all.");
      }
      const items = await github.listPullRequests(rest[0], state as "open" | "closed" | "all");
      if (!items.length) return console.log("No hay Pull Requests para ese filtro.");
      for (const item of items) {
        console.log("#" + item.number + " [" + item.state + "] " + item.title);
        console.log("  " + item.head + " → " + item.base + (item.draft ? " | borrador" : ""));
        console.log("  " + item.htmlUrl);
      }
      return;
    }
    if (action === "pr") {
      const prAction = rest[0];
      if (prAction === "show" && rest.length === 3) {
        const projectId = rest[1];
        const number = Number(rest[2]);
        if (!Number.isSafeInteger(number) || number < 1) throw new Error("Número de Pull Request inválido.");
        const item = await github.getPullRequest(projectId, number);
        console.log("#" + item.number + " [" + item.state + "] " + item.title);
        console.log(item.head + " → " + item.base);
        console.log(item.htmlUrl);
        if (item.body) console.log("\n" + item.body);
        return;
      }
      if (prAction === "create" && rest.length === 6 && rest[5] === "--confirm") {
        const item = await github.createPullRequest(rest[1], rest[2], rest[3], rest[4], true);
        console.log("Pull Request creado: #" + item.number);
        console.log(item.title);
        console.log(item.htmlUrl);
        return;
      }
    }
    if (action === "issues" && rest.length >= 1 && rest.length <= 2) {
      const state = rest[1] ?? "open";
      if (!["open", "closed", "all"].includes(state)) {
        throw new Error("El filtro debe ser open, closed o all.");
      }
      const items = await github.listIssues(rest[0], state as "open" | "closed" | "all");
      if (!items.length) return console.log("No hay Issues para ese filtro.");
      for (const item of items) {
        console.log("#" + item.number + " [" + item.state + "] " + item.title);
        console.log("  " + item.htmlUrl);
      }
      return;
    }
    if (action === "issue") {
      const issueAction = rest[0];
      if (issueAction === "show" && rest.length === 3) {
        const number = Number(rest[2]);
        if (!Number.isSafeInteger(number) || number < 1) throw new Error("Número de Issue inválido.");
        const item = await github.getIssue(rest[1], number);
        console.log("#" + item.number + " [" + item.state + "] " + item.title);
        console.log(item.htmlUrl);
        if (item.body) console.log("\n" + item.body);
        return;
      }
      if (issueAction === "create" && rest.length === 5 && rest[4] === "--confirm") {
        const item = await github.createIssue(rest[1], rest[2], rest[3], true);
        console.log("Issue creado: #" + item.number);
        console.log(item.title);
        console.log(item.htmlUrl);
        return;
      }
      if (issueAction === "link" && rest.length === 5 && rest[4] === "--confirm") {
        const number = Number(rest[3]);
        if (!Number.isSafeInteger(number) || number < 1) throw new Error("Número de Issue inválido.");
        const linked = await github.linkIssue(rest[1], rest[2], number, true);
        console.log("Tarea " + linked.taskId + " vinculada con el Issue #" + linked.issueNumber);
        console.log(linked.issueUrl);
        return;
      }
      if (issueAction === "unlink" && rest.length === 4 && rest[3] === "--confirm") {
        const removed = await github.unlinkIssue(rest[1], rest[2], true);
        console.log("Issue #" + removed.issueNumber + " desvinculado de " + removed.taskId + ".");
        return;
      }
      if (issueAction === "links" && rest.length === 2) {
        const items = await github.issueLinks(rest[1]);
        if (!items.length) return console.log("No hay Issues vinculados a tareas de este proyecto.");
        for (const item of items) {
          console.log(item.taskId + " → #" + item.issueNumber + " | " + item.issueUrl);
        }
        return;
      }
    }
    throw new Error("Uso de GitHub no válido. Ejecuta troc help.");
  }

  if (group === "history") {
    const limit = action ? Number(action) : 20;
    if (!Number.isInteger(limit) || limit < 1) throw new Error("El límite debe ser un número entero positivo.");
    const entries = await history.list(limit);
    if (!entries.length) return console.log("Todavía no hay operaciones registradas.");
    for (const entry of entries) {
      console.log(entry.timestamp + " | " + entry.action + " | " + entry.entityId);
      console.log("  " + entry.summary);
    }
    return;
  }

  if (group === "ide") {
    const [ideName, ideAction, projectId] = [action, rest[0], rest[1]];
    if (ideName === "vscode" && ideAction === "detect") {
      const result = await detectVSCode();
      console.log(result.name + ": " + (result.installed ? "detectado" : "no detectado"));
      if (result.version) console.log("Versión: " + result.version);
      if (result.executable) console.log("Ejecutable: " + result.executable);
      console.log(result.details);
      return;
    }
    if (ideName === "vs2026" && ideAction === "detect") {
      const result = await detectVisualStudio2026();
      console.log(result.name + ": " + (result.installed ? "detectado" : "no detectado"));
      if (result.executable) console.log("Ejecutable: " + result.executable);
      console.log(result.details);
      return;
    }
    if (ideName === "ssms22" && ideAction === "detect") {
      const result = await detectSSMS22();
      console.log(result.name + ": " + (result.installed ? "detectado" : "no detectado"));
      if (result.executable) console.log("Ejecutable: " + result.executable);
      console.log(result.details);
      return;
    }
    if ((ideName === "vscode" || ideName === "vs2026") && ideAction === "open" && projectId) {
      const project = await projects.get(projectId);
      if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
      if (!existsSync(project.directory)) throw new Error("La carpeta del proyecto ya no existe.");
      if (ideName === "vscode") {
        const result = await detectVSCode();
        if (!result.installed || !result.executable) {
          throw new Error("Visual Studio Code no está instalado o no se encontró su ejecutable.");
        }
        launch(result.executable, [project.directory]);
        console.log("Abriendo " + project.name + " en Visual Studio Code.");
        return;
      }
      const result = await detectVisualStudio2026();
      if (!result.installed || !result.executable) {
        throw new Error("Visual Studio 2026 no está instalado o no se encontró devenv.exe.");
      }
      const solution = await findSolution(project.directory);
      if (!solution) throw new Error("No se encontró un archivo .sln, .slnx o .csproj en el proyecto.");
      launch(result.executable, [solution]);
      console.log("Abriendo " + path.basename(solution) + " en Visual Studio 2026.");
      return;
    }
    if (ideName === "ssms22" && ideAction === "external-tool" && projectId) {
      const project = await projects.get(projectId);
      if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(project.id)) {
        throw new Error("El ID del proyecto contiene caracteres no compatibles con una configuración de herramienta externa.");
      }
      console.log("Configuración para SSMS 22 — Herramientas > Herramientas externas");
      console.log("Título: JCLI — inspeccionar archivo SQL");
      console.log("Comando: troc.cmd");
      console.log("Argumentos: ide ssms22 inspect \"" + project.id + "\" \"$(ItemPath)\"");
      console.log("Directorio inicial: " + process.cwd());
      console.log("Usar ventana de resultados: Sí");
      console.log("Tratar salida como Unicode: Sí");
      console.log("Abre un archivo .sql guardado y ejecuta la herramienta desde el menú Herramientas.");
      return;
    }
    if (ideName === "ssms22" && ideAction === "inspect" && projectId && rest[2]) {
      const project = await projects.get(projectId);
      if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
      const report = await inspectSqlScript(project.directory, rest[2]);
      console.log("JCLI — inspección local para SSMS 22");
      console.log("Proyecto: " + project.name + " (" + project.id + ")");
      console.log("Archivo: " + report.relativePath);
      console.log("Tamaño: " + report.sizeBytes.toLocaleString("es-MX") + " bytes");
      console.log("Líneas: " + report.lineCount.toLocaleString("es-MX"));
      console.log("No se abrió una conexión ni se ejecutó SQL.");
      return;
    }
    if (ideName === "ssms22" && ideAction === "open" && projectId) {
      const project = await projects.get(projectId);
      if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
      if (!existsSync(project.directory)) throw new Error("La carpeta del proyecto ya no existe.");
      const result = await detectSSMS22();
      if (!result.installed || !result.executable) {
        throw new Error("SSMS 22 no está instalado o no se encontró Ssms.exe. Configura SSMS22_PATH si la instalación es personalizada.");
      }
      if (rest[2]) {
        const report = await inspectSqlScript(project.directory, rest[2]);
        launch(result.executable, [report.absolutePath]);
        console.log("Abriendo " + report.relativePath + " en SQL Server Management Studio 22.");
      } else {
        launch(result.executable, []);
        console.log("Abriendo SQL Server Management Studio 22.");
      }
      return;
    }
    throw new Error("Uso de IDE no válido. Ejecuta troc help.");
  }

  if (group === "ai") {
    if (action === "ask" && rest.length >= 2) {
      const providerId = rest[0];
      const prompt = rest.slice(1).join(" ");
      console.log("Consultando " + providerId + "...");
      const result = await ai.ask(providerId, prompt);
      console.log("\n[" + result.provider + " · " + result.model + "]\n");
      console.log(result.text);
      if (result.usage.inputTokens !== undefined || result.usage.outputTokens !== undefined) {
        console.log("\nTokens informados por el proveedor: entrada " +
          (result.usage.inputTokens ?? "?") + " / salida " + (result.usage.outputTokens ?? "?"));
      }
      return;
    }
    if (action === "usage") {
      const limit = rest[0] ? Number(rest[0]) : 20;
      if (!Number.isInteger(limit) || limit < 1) throw new Error("El límite debe ser un entero positivo.");
      const summary = await aiUsage.totalsToday();
      console.log("Consumo registrado hoy (UTC)");
      console.log("Solicitudes: " + summary.requests);
      console.log("Tokens de entrada: " + summary.inputTokens);
      console.log("Tokens de salida: " + summary.outputTokens);
      console.log("\nÚltimas solicitudes:");
      const entries = await aiUsage.list(limit);
      for (const entry of entries) {
        console.log(entry.timestamp + " | " + entry.provider + " | " + entry.model +
          " | " + entry.result + " | " + entry.inputCharacters + " caracteres");
        if (entry.inputTokens !== undefined || entry.outputTokens !== undefined) {
          console.log("  Tokens: " + (entry.inputTokens ?? "?") + " entrada / " +
            (entry.outputTokens ?? "?") + " salida");
        }
      }
      console.log("\nNota: el registro de tokens depende de lo que devuelva cada proveedor; no representa un importe en dinero.");
      return;
    }
    throw new Error("Uso de IA no válido. Ejecuta troc help.");
  }

  if (group === "dev") {
    if (action === "inspect" && rest[0]) {
      const toolchain = await dev.inspect(rest[0]);
      console.log("Entorno de desarrollo: " + toolchain.projectId);
      console.log("Carpeta: " + toolchain.directory);
      console.log("Detectado: " + (toolchain.detected.join(", ") || "ningún entorno compatible"));
      console.log("Comandos disponibles:");
      for (const command of toolchain.commands) {
        console.log("  [" + command.action + "] " + command.display);
        console.log("    " + command.note);
      }
      for (const warning of toolchain.warnings) console.log("Aviso: " + warning);
      return;
    }
    if (action === "plan" && rest[0] && rest[1]) {
      if (rest[1] !== "build" && rest[1] !== "test") {
        throw new Error("La acción debe ser build o test.");
      }
      const toolchain = await dev.inspect(rest[0]);
      const commands = toolchain.commands.filter((command) => command.action === rest[1]);
      console.log("Plan " + rest[1] + " para " + rest[0]);
      if (!commands.length) console.log("No hay comandos compatibles para esta acción.");
      for (const command of commands) {
        console.log("  " + command.display);
        console.log("  " + command.note);
      }
      for (const warning of toolchain.warnings) console.log("Aviso: " + warning);
      console.log("\nPlanear no ejecuta comandos ni modifica archivos.");
      console.log("Para ejecutar, vuelve a revisar el comando y usa --confirm.");
      return;
    }
    if (action === "vscode-tasks" && rest[0]) {
      if (rest.length !== 2 || rest[1] !== "--confirm") {
        throw new Error("Crear .vscode/tasks.json requiere --confirm. Consulta primero troc dev inspect " + rest[0] + ".");
      }
      const file = await dev.configureVSCodeTasks(rest[0], true);
      console.log("Tareas de VS Code creadas en: " + file);
      console.log("Abre la paleta de comandos de VS Code y ejecuta Tasks: Run Task.");
      console.log("JCLI no sobrescribe tasks.json existentes.");
      return;
    }
    if (action === "run" && rest[0] && rest[1]) {
      if (rest[1] !== "build" && rest[1] !== "test") {
        throw new Error("La acción debe ser build o test.");
      }
      if (rest.length !== 3 || rest[2] !== "--confirm") {
        throw new Error("Esta acción requiere el parámetro --confirm. Consulta primero troc dev plan " + rest[0] + " " + rest[1] + ".");
      }
      const results = await dev.run(rest[0], rest[1], true);
      for (const result of results) {
        console.log("\n[" + result.status + "] " + result.command);
        console.log("Duración: " + result.durationMs + " ms | Código de salida: " +
          (result.exitCode === null ? "sin código" : result.exitCode));
        if (result.timedOut) console.log("El proceso superó el tiempo límite.");
        console.log("ID de ejecución: " + result.id);
        if (result.stdout) console.log("\nSTDOUT:\n" + result.stdout);
        if (result.stderr) console.log("\nSTDERR:\n" + result.stderr);
        console.log("\nConsulta con: troc dev show " + result.id);
      }
      return;
    }
    if (action === "show" && rest[0]) {
      const result = await dev.getRun(rest[0]);
      if (!result) throw new Error("No se encontró la ejecución " + rest[0] + ".");
      console.log(result.command + " — " + result.status);
      console.log("Proyecto: " + result.projectId);
      console.log("Inicio: " + result.startedAt);
      console.log("Duración: " + result.durationMs + " ms");
      console.log("Código de salida: " + (result.exitCode ?? "sin código"));
      if (result.stdout) console.log("\nSTDOUT:\n" + result.stdout);
      if (result.stderr) console.log("\nSTDERR:\n" + result.stderr);
      return;
    }
    if (action === "runs") {
      const limit = rest[0] ? Number(rest[0]) : 20;
      if (!Number.isInteger(limit) || limit < 1) throw new Error("El límite debe ser un entero positivo.");
      const results = await devRuns.list(limit);
      if (!results.length) return console.log("No hay ejecuciones locales guardadas.");
      for (const result of results) {
        console.log(result.id + " | " + result.projectId + " | " +
          result.command + " | " + result.status + " | " + result.durationMs + " ms");
      }
      return;
    }
    throw new Error("Uso de dev no válido. Ejecuta troc help.");
  }


  if (group === "patch") {
    if (action === "draft" && rest.length === 3) {
      const patch = await patchService.draft(rest[0], rest[1], rest[2]);
      console.log("Propuesta creada: " + patch.id);
      console.log("Proyecto: " + patch.projectId);
      console.log("Archivo: " + patch.targetPath);
      console.log("Candidato: " + patch.candidatePath);
      console.log("Estado: " + patch.status);
      console.log("Revisa los cambios con: troc patch show " + patch.id);
      return;
    }
    if (action === "show" && rest.length === 1) {
      const patch = await patchService.get(rest[0]);
      if (!patch) throw new Error("No se encontró la propuesta " + rest[0] + ".");
      console.log("Propuesta " + patch.id + " — " + patch.status);
      console.log("Proyecto: " + patch.projectId);
      console.log("Archivo: " + patch.targetPath);
      console.log("Candidato: " + patch.candidatePath);
      console.log("Creada: " + patch.createdAt);
      console.log("SHA-256 original: " + patch.originalHash);
      console.log("SHA-256 propuesto: " + patch.proposedHash);
      console.log("");
      console.log(renderPatchDiff(patch));
      if (patch.status === "draft") {
        console.log("");
        console.log("Cuando termines de revisar, usa troc patch approve " + patch.id + ".");
      }
      return;
    }
    if (action === "list") {
      const limit = rest[0] ? Number(rest[0]) : 20;
      if (!Number.isInteger(limit) || limit < 1) throw new Error("El límite debe ser un entero positivo.");
      const items = await patchService.list(limit);
      if (!items.length) return console.log("No hay propuestas de cambios guardadas.");
      for (const item of items) {
        console.log(item.id + " | " + item.status + " | " + item.projectId + " | " + item.targetPath);
      }
      return;
    }
    if (action === "approve" && rest.length === 1) {
      const patch = await patchService.approve(rest[0]);
      console.log("Propuesta aprobada: " + patch.id);
      console.log("Para aplicarla: troc patch apply " + patch.id + " --confirm");
      return;
    }
    if (action === "reject" && rest.length === 1) {
      const patch = await patchService.reject(rest[0]);
      console.log("Propuesta rechazada: " + patch.id);
      return;
    }
    if (action === "apply" && rest.length === 2 && rest[1] === "--confirm") {
      const patch = await patchService.apply(rest[0], true);
      console.log("Cambio aplicado: " + patch.targetPath);
      console.log("Respaldo: " + (patch.backupPath || "no disponible"));
      console.log("Estado: " + patch.status);
      console.log("Para revertir: troc patch rollback " + patch.id + " --confirm");
      return;
    }
    if (action === "rollback" && rest.length === 2 && rest[1] === "--confirm") {
      const patch = await patchService.rollback(rest[0], true);
      console.log("Respaldo restaurado: " + patch.targetPath);
      console.log("Estado: " + patch.status);
      return;
    }
    throw new Error("Uso de patch no válido. Ejecuta troc help.");
  }


  if (group === "memory") {
    const projectId = action === "note" || action === "decision" ? rest[1] : rest[0];
    if (!projectId) throw new Error("Indica el ID de un proyecto registrado.");
    const project = await projects.get(projectId);
    if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");

    if (action === "show" && rest.length === 1) {
      const data = await knowledge.get(project.id);
      console.log("Memoria técnica: " + project.name + " (" + project.id + ")");
      console.log("Actualizada: " + (data.updatedAt || "sin registros"));
      console.log("\nResumen:");
      console.log(data.summary || "Todavía no hay resumen.");
      console.log("\nEstructura:");
      if (!data.structure) console.log("Sin análisis guardado. Usa troc memory scan " + project.id + ".");
      else {
        console.log("Fecha: " + data.structure.generatedAt);
        console.log("Archivos revisados: " + data.structure.filesScanned);
        console.log("Lenguajes: " + (data.structure.languages.map((item) => item.name + " (" + item.files + ")").join(", ") || "ninguno"));
        console.log("Tecnologías: " + (data.structure.technologies.join(", ") || "ninguna"));
        console.log("Manifiestos: " + (data.structure.manifests.join(", ") || "ninguno"));
      }
      console.log("\nNotas: " + data.notes.length);
      for (const item of data.notes) console.log("  " + item.id + " | " + item.content);
      console.log("\nDecisiones: " + data.decisions.length);
      for (const item of data.decisions) {
        console.log("  " + item.id + " | " + item.title + ": " + item.decision);
        if (item.context) console.log("    Contexto: " + item.context);
      }
      return;
    }

    if (action === "summary" && rest.length >= 2) {
      const summary = await knowledge.setSummary(project.id, rest.slice(1).join(" "));
      await history.record("memory.summary_updated", project.id, "Resumen de memoria actualizado para " + project.name);
      console.log("Resumen guardado para " + project.name + ".");
      console.log("Caracteres: " + (summary.summary?.length ?? 0));
      return;
    }

    if (action === "scan" && rest.length === 1) {
      if (!existsSync(project.directory)) throw new Error("La carpeta del proyecto ya no existe.");
      const analysis = await analyzeProject(project.directory, 2500);
      const snapshot = await knowledge.saveStructure(project.id, analysis);
      await history.record("memory.structure_scanned", project.id,
        "Estructura analizada (" + snapshot.filesScanned + " archivos revisados)");
      console.log("Estructura guardada para " + project.name + ".");
      console.log("Archivos revisados: " + snapshot.filesScanned);
      console.log("Lenguajes: " + (snapshot.languages.map((item) => item.name).join(", ") || "ninguno"));
      console.log("Tecnologías: " + (snapshot.technologies.join(", ") || "ninguna"));
      console.log("Manifiestos: " + (snapshot.manifests.join(", ") || "ninguno"));
      console.log("No se guardó el contenido de los archivos fuente.");
      return;
    }

    if (action === "context" && rest.length === 1) {
      const context = await knowledge.getContext(project.id);
      console.log(context || "Todavía no hay memoria técnica para este proyecto.");
      return;
    }

    if (action === "note") {
      const [noteAction, , ...contentParts] = rest;
      if (noteAction === "add" && contentParts.length) {
        const note = await knowledge.addNote(project.id, contentParts.join(" "));
        await history.record("memory.note_added", note.id, "Nota agregada a " + project.name);
        console.log("Nota guardada: " + note.id);
        return;
      }
      if (noteAction === "list" && rest.length === 2) {
        const data = await knowledge.get(project.id);
        if (!data.notes.length) return console.log("No hay notas para este proyecto.");
        for (const item of data.notes) console.log(item.id + " | " + item.createdAt + " | " + item.content);
        return;
      }
      if (noteAction === "remove" && contentParts.length === 1) {
        const removed = await knowledge.removeNote(project.id, contentParts[0]);
        await history.record("memory.note_removed", removed.id, "Nota retirada de " + project.name);
        console.log("Nota eliminada: " + removed.id);
        return;
      }
    }

    if (action === "decision") {
      const [decisionAction, , ...parts] = rest;
      if (decisionAction === "add" && parts.length >= 2) {
        const [title, decision, ...contextParts] = parts;
        const entry = await knowledge.addDecision(project.id, title, decision, contextParts.join(" "));
        await history.record("memory.decision_added", entry.id,
          "Decisión técnica registrada: " + entry.title + " (" + project.name + ")");
        console.log("Decisión guardada: " + entry.id);
        return;
      }
      if (decisionAction === "list" && rest.length === 2) {
        const data = await knowledge.get(project.id);
        if (!data.decisions.length) return console.log("No hay decisiones registradas para este proyecto.");
        for (const item of data.decisions) {
          console.log(item.id + " | " + item.title + ": " + item.decision);
          if (item.context) console.log("  Contexto: " + item.context);
        }
        return;
      }
      if (decisionAction === "remove" && parts.length === 1) {
        const removed = await knowledge.removeDecision(project.id, parts[0]);
        await history.record("memory.decision_removed", removed.id,
          "Decisión técnica retirada: " + removed.title + " (" + project.name + ")");
        console.log("Decisión eliminada: " + removed.id);
        return;
      }
    }

    throw new Error("Uso de memoria no válido. Ejecuta troc help.");
  }

  if (group === "team") {
    if (action === "agents") {
      const agents = await agentRegistry.list();
      for (const agent of agents) {
        console.log(agent.id + " — " + agent.name + " (" + agent.provider + ")");
        console.log("  " + agent.purpose + (agent.enabled ? "" : " [deshabilitado]"));
      }
      console.log("\nMáximo por ejecución: 4 agentes.");
      return;
    }

    const taskId = rest[0];
    const filePaths: string[] = [];
    if (action === "plan" || action === "run") {
      if (!taskId) throw new Error("Indica el ID de la tarea.");
      for (let index = 1; index < rest.length; index++) {
        if (rest[index] !== "--file" || !rest[index + 1] || rest[index + 1].startsWith("--")) {
          throw new Error("Usa --file seguido de una ruta relativa al proyecto.");
        }
        filePaths.push(rest[index + 1]);
        index++;
      }
      const plan = await team.plan(taskId, filePaths);
      console.log("Plan de equipo para " + plan.taskId + " — " + plan.taskTitle);
      if (plan.projectName) console.log("Proyecto: " + plan.projectName);
      console.log("Agentes (" + plan.estimatedRequests + " solicitudes estimadas):");
      for (const agent of plan.agents) console.log("  " + agent.id + " — " + agent.name + " [" + agent.provider + "]");
      console.log("Archivos enviados: " + (plan.files.join(", ") || "ninguno"));
      console.log("Memoria del proyecto: " + (plan.memorySummary ? "resumen" : "sin resumen") +
        " | estructura: " + (plan.memoryStructure ? "sí" : "no") +
        " | notas: " + (plan.memoryNotes ?? 0) + " | decisiones: " + (plan.memoryDecisions ?? 0));
      if (action === "plan") {
        console.log("\nEste comando solo prepara el plan; no contacta proveedores.");
        return;
      }
      console.log("\nLos agentes solo devolverán propuestas. No se escribirán archivos del proyecto.");
      const run = await team.run(taskId, filePaths);
      console.log("\nEjecución: " + run.id);
      console.log("Estado: " + run.status);
      for (const result of run.agents) {
        console.log("\n[" + result.agentId + "] " + result.status +
          (result.model ? " — " + result.model : ""));
        if (result.output) console.log(result.output);
        if (result.error) console.log("Error: " + result.error);
      }
      console.log("\nRevisa el resultado con: troc team show " + run.id);
      return;
    }
    if (action === "show" && taskId) {
      const run = await team.getRun(taskId);
      if (!run) throw new Error("No se encontró la ejecución " + taskId + ".");
      console.log("Ejecución " + run.id + " — tarea " + run.taskId);
      console.log("Estado: " + run.status);
      console.log("Archivos de contexto: " + (run.files.join(", ") || "ninguno"));
      console.log("Decisión: " + (run.decision ?? "pendiente de revisión"));
      for (const result of run.agents) {
        console.log("\n[" + result.agentId + "] " + result.status);
        if (result.output) console.log(result.output);
        if (result.error) console.log("Error: " + result.error);
      }
      return;
    }
    if (action === "decide" && rest[0] && rest[1]) {
      const decision = rest[1] === "accept" ? "accepted" :
        rest[1] === "reject" ? "rejected" : undefined;
      if (!decision) throw new Error("La decisión debe ser accept o reject.");
      await team.decide(rest[0], decision);
      console.log("Decisión registrada. No se modificaron archivos del proyecto.");
      return;
    }
    throw new Error("Uso de team no válido. Ejecuta troc help.");
  }

  if (group === "providers") {
    const { readFile } = await import("node:fs/promises");
    const configText = await readFile(new URL("../config/providers.json", import.meta.url), "utf8");
    const providersConfig = JSON.parse(configText) as {
      providers: Array<{ id: string; name: string; env: string; enabled?: boolean }>;
    };
    const providers = providersConfig.providers;
    if (action === "list") {
      for (const provider of providers) console.log(provider.id + " — " + provider.name);
      return;
    }
    if (action === "status") {
      for (const provider of providers) {
        console.log(provider.name + ": " + (process.env[provider.env] ? "clave detectada" : "sin configurar"));
      }
      console.log("Nota: detectar una clave no comprueba conexión ni saldo de API.");
      return;
    }
    if ((action === "test" || action === "models") && rest[0]) {
      const models = await ai.models(rest[0]);
      console.log("Conexión con " + rest[0] + ": correcta");
      if (action === "test") {
        console.log("Modelos disponibles: " + models.length);
        console.log("Consulta completa con: troc providers models " + rest[0]);
      } else if (!models.length) {
        console.log("El proveedor no devolvió modelos en su catálogo.");
      } else {
        for (const model of models) console.log("  " + model);
      }
      return;
    }
  }

  help();
}
