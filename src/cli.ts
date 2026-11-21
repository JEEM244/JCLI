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
import { analyzeProject } from "./projects/projectAnalyzer.js";
import { inspectGit } from "./projects/gitInspector.js";
import { detectVSCode, detectVisualStudio2026 } from "./integrations/ide/detector.js";
import type { Task, TaskPriority, TaskStatus } from "./types.js";

const store = new TaskStore();
const projects = new ProjectStore();
const history = new HistoryStore();
const ai = new AIService();
const aiUsage = new AIUsageStore();
const agentRegistry = new AgentRegistry();
const teamRuns = new TeamRunStore();
const team = new TeamCoordinator(store, projects, ai, agentRegistry, teamRuns, history);
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
    "  troc history [limite]",
    "  troc ide vscode detect",
    "  troc ide vs2026 detect",
    "  troc ide vscode open <ID>",
    "  troc ide vs2026 open <ID>",
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
    entry.isFile() && /\.(sln|slnx|csproj)$/i.test(entry.name)
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
      const requested = rest.slice(1).join("").split(",").map((id) => id.trim()).filter(Boolean);
      const available = await agentRegistry.list();
      if (requested.length > 3) throw new Error("Solo puedes asignar hasta 3 agentes por tarea.");
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

  if (group === "team") {
    if (action === "agents") {
      const agents = await agentRegistry.list();
      for (const agent of agents) {
        console.log(agent.id + " — " + agent.name + " (" + agent.provider + ")");
        console.log("  " + agent.purpose + (agent.enabled ? "" : " [deshabilitado]"));
      }
      console.log("\nMáximo por ejecución: 3 agentes.");
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
