import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { TaskStore } from "./tasks/taskStore.js";
import type { TaskPriority, TaskStatus } from "./types.js";

const store = new TaskStore();
const statuses: TaskStatus[] = ["pendientes", "en_proceso", "completadas", "archivadas"];

function help(): void {
  console.log(`
JCLI — Centro de control local
Comando: troc

Uso:
  troc init
  troc tasks list [estado]
  troc tasks add
  troc tasks done <ID>
  troc tasks move <ID> <estado>
  troc providers list
  troc providers status

Estados: ${statuses.join(", ")}
`);
}

async function addTask(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const id = (await rl.question("ID (ej. JCLI-002): ")).trim();
    const title = (await rl.question("Título: ")).trim();
    const description = (await rl.question("Descripción: ")).trim();
    const rawPriority = (await rl.question("Prioridad (baja/media/alta/urgente) [media]: ")).trim() || "media";
    const priority = rawPriority as TaskPriority;
    if (!["baja", "media", "alta", "urgente"].includes(priority)) throw new Error("Prioridad no válida.");
    if (!id || !title) throw new Error("El ID y el título son obligatorios.");
    const task = await store.add({ id, title, description, priority, created: new Date().toISOString().slice(0, 10) });
    console.log(`Tarea ${task.id} creada.`);
  } finally {
    rl.close();
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
    if (action === "list") {
      const status = rest[0] as TaskStatus | undefined;
      if (status && !statuses.includes(status)) throw new Error("Estado no válido.");
      const tasks = await store.list(status);
      if (!tasks.length) return console.log("No hay tareas registradas.");
      for (const task of tasks) {
        console.log(`[${task.status}] ${task.id} — ${task.title} (prioridad: ${task.priority})`);
        if (task.description) console.log(`  ${task.description}`);
      }
      return;
    }
    if (action === "add") return addTask();
    if (action === "done" && rest[0]) {
      await store.move(rest[0], "completadas");
      console.log(`Tarea ${rest[0]} marcada como completada.`);
      return;
    }
    if (action === "move" && rest[0] && rest[1]) {
      const status = rest[1] as TaskStatus;
      if (!statuses.includes(status)) throw new Error("Estado no válido.");
      await store.move(rest[0], status);
      console.log(`Tarea ${rest[0]} movida a ${status}.`);
      return;
    }
    throw new Error("Uso de tareas no válido. Ejecuta troc help.");
  }

  if (group === "providers") {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const configText = await readFile(resolve("config/providers.json"), "utf8");
    const providersConfig = JSON.parse(configText) as {
      providers: Array<{ id: string; name: string; env: string; enabled?: boolean }>;
    };
    const providers = providersConfig.providers;
    if (action === "list") {
      for (const provider of providers) console.log(`${provider.id} — ${provider.name}`);
      return;
    }
    if (action === "status") {
      for (const provider of providers) console.log(`${provider.name}: ${process.env[provider.env] ? "clave detectada" : "sin configurar"}`);
      console.log("Nota: detectar una clave no comprueba conexión ni saldo de API.");
      return;
    }
  }

  help();
}
