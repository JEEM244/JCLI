import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Task, TaskPriority, TaskStatus } from "../types.js";

const STATUSES: TaskStatus[] = ["pendientes", "en_proceso", "completadas", "archivadas"];
const PRIORITIES: TaskPriority[] = ["baja", "media", "alta", "urgente"];

type TaskChanges = Partial<Pick<Task, "title" | "description" | "priority" | "projectId" | "agentIds">>;

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const temporary = filePath + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, filePath);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export class TaskStore {
  constructor(private readonly directory = path.resolve("data/tasks")) {}

  private file(status: TaskStatus): string {
    return path.join(this.directory, status + ".txt");
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const status of STATUSES) {
      try {
        await readFile(this.file(status), "utf8");
      } catch (error) {
        if (!isMissingFile(error)) throw error;
        await writeAtomic(this.file(status), "");
      }
    }
  }

  async list(status?: TaskStatus): Promise<Task[]> {
    await this.initialize();
    const selected = status ? [status] : STATUSES;
    const groups = await Promise.all(selected.map(async (item) =>
      this.parse(await readFile(this.file(item), "utf8"), item)
    ));
    return groups.flat();
  }

  async get(id: string): Promise<Task | undefined> {
    const tasks = await this.list();
    return tasks.find((task) => task.id.toLowerCase() === id.toLowerCase());
  }

  async search(query: string): Promise<Task[]> {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) throw new Error("Escribe un texto para buscar.");
    const tasks = await this.list();
    return tasks.filter((task) => [
      task.id,
      task.title,
      task.description,
      task.projectId ?? "",
      task.priority,
      task.status
    ].some((value) => value.toLocaleLowerCase().includes(normalized)));
  }

  async add(input: Omit<Task, "status"> & { status?: TaskStatus }): Promise<Task> {
    await this.initialize();
    const existing = await this.list();
    if (existing.some((task) => task.id.toLowerCase() === input.id.toLowerCase())) {
      throw new Error("Ya existe una tarea con el ID " + input.id + ".");
    }
    this.validateTask({ ...input, status: input.status ?? "pendientes" });
    const task: Task = { ...input, status: input.status ?? "pendientes" };
    await this.append(task);
    return task;
  }

  async update(id: string, changes: TaskChanges): Promise<Task> {
    const all = await this.list();
    const current = all.find((task) => task.id.toLowerCase() === id.toLowerCase());
    if (!current) throw new Error("No se encontró la tarea " + id + ".");

    const updated: Task = { ...current, ...changes };
    this.validateTask(updated);
    const items = await this.list(current.status);
    const next = items.map((task) => task.id === current.id ? updated : task);
    await writeAtomic(this.file(current.status), this.serialize(next));
    return updated;
  }

  async move(id: string, status: TaskStatus): Promise<Task> {
    await this.initialize();
    if (!STATUSES.includes(status)) throw new Error("Estado no válido.");
    const all = await this.list();
    const task = all.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!task) throw new Error("No se encontró la tarea " + id + ".");
    if (task.status === status) return task;

    const updated: Task = { ...task, status };
    const sourceFile = this.file(task.status);
    const targetFile = this.file(status);
    const sourceTasks = this.parse(await readFile(sourceFile, "utf8"), task.status);
    const targetTasks = this.parse(await readFile(targetFile, "utf8"), status);
    if (targetTasks.some((item) => item.id.toLowerCase() === task.id.toLowerCase())) {
      throw new Error("La tarea ya existe en el archivo de destino. Revisa los TXT.");
    }

    const oldTarget = await readFile(targetFile, "utf8");
    const newTarget = this.serialize([...targetTasks, updated]);
    const newSource = this.serialize(sourceTasks.filter((item) => item.id !== task.id));

    await writeAtomic(targetFile, newTarget);
    try {
      await writeAtomic(sourceFile, newSource);
    } catch (error) {
      await writeAtomic(targetFile, oldTarget).catch(() => undefined);
      throw error;
    }
    return updated;
  }

  private async append(task: Task): Promise<void> {
    const filePath = this.file(task.status);
    const current = await readFile(filePath, "utf8");
    const separator = current.trim() ? "\n\n" : "";
    const next = current.trimEnd() + separator + this.serialize([task]);
    await writeAtomic(filePath, next);
  }

  private validateTask(task: Task): void {
    if (!task.id.trim() || !task.title.trim()) throw new Error("El ID y el título son obligatorios.");
    if (!STATUSES.includes(task.status)) throw new Error("Estado de tarea no válido.");
    if (!PRIORITIES.includes(task.priority)) throw new Error("Prioridad de tarea no válida.");
    if (task.agentIds && (
      task.agentIds.length > 4 ||
      new Set(task.agentIds.map((id) => id.toLowerCase())).size !== task.agentIds.length ||
      task.agentIds.some((id) => !/^[a-z0-9][a-z0-9-]{0,39}$/i.test(id))
    )) {
      throw new Error("La asignación debe contener hasta 4 IDs de agente válidos y sin repetir.");
    }
    if (task.projectId !== undefined && !task.projectId.trim()) {
      throw new Error("El ID del proyecto no puede estar vacío.");
    }
  }

  private parse(content: string, expectedStatus?: TaskStatus): Task[] {
    const startCount = (content.match(/\[TASK\]/g) ?? []).length;
    const endCount = (content.match(/\[\/TASK\]/g) ?? []).length;
    if (startCount !== endCount) {
      throw new Error("El archivo contiene bloques [TASK] sin cerrar o cierres sobrantes.");
    }
    const blocks = content.match(/\[TASK\][\s\S]*?\[\/TASK\]/g) ?? [];
    return blocks.map((block, index) => {
      const values = new Map<string, string>();
      for (const line of block.replace(/^\[TASK\]|\[\/TASK\]$/g, "").trim().split(/\r?\n/)) {
        const separator = line.indexOf("=");
        if (separator > 0) values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
      }

      const status = values.get("status") as TaskStatus;
      const priority = values.get("priority") as TaskPriority;
      const task: Task = {
        id: values.get("id") ?? "",
        title: values.get("title") ?? "",
        description: values.get("description") ?? "",
        status,
        priority,
        created: values.get("created") ?? "",
        ...(values.has("project") ? { projectId: values.get("project") } : {}),
        ...(values.has("agents") ? { agentIds: values.get("agents")?.split(",").map((id) => id.trim()).filter(Boolean) } : {})
      };

      try {
        this.validateTask(task);
      } catch (error) {
        throw new Error("Tarea inválida en el bloque " + (index + 1) +
          (expectedStatus ? " de " + expectedStatus + ". " : ". ") +
          (error instanceof Error ? error.message : "Revisa el archivo TXT."));
      }
      if (expectedStatus && status !== expectedStatus) {
        throw new Error("La tarea " + task.id + " declara status=" + status +
          " dentro de " + expectedStatus + ". Corrige el estado en el TXT.");
      }
      return task;
    });
  }

  private serialize(tasks: Task[]): string {
    return tasks.map((task) => [
      "[TASK]",
      "id=" + task.id,
      "title=" + task.title.replace(/\r?\n/g, " "),
      "description=" + task.description.replace(/\r?\n/g, " "),
      "status=" + task.status,
      "priority=" + task.priority,
      "created=" + task.created,
      ...(task.projectId ? ["project=" + task.projectId] : []),
      ...(task.agentIds?.length ? ["agents=" + task.agentIds.join(",")] : []),
      "[/TASK]"
    ].join("\n")).join("\n\n");
  }
}
