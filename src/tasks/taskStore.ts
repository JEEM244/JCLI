import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Task, TaskStatus } from "../types.js";

const STATUSES: TaskStatus[] = ["pendientes", "en_proceso", "completadas", "archivadas"];

export class TaskStore {
  constructor(private readonly directory = path.resolve("data/tasks")) {}

  private file(status: TaskStatus): string {
    return path.join(this.directory, `${status}.txt`);
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const status of STATUSES) {
      try {
        await readFile(this.file(status), "utf8");
      } catch {
        await writeFile(this.file(status), "", "utf8");
      }
    }
  }

  async list(status?: TaskStatus): Promise<Task[]> {
    await this.initialize();
    const statuses = status ? [status] : STATUSES;
    const groups = await Promise.all(statuses.map(async (item) => this.parse(await readFile(this.file(item), "utf8"))));
    return groups.flat();
  }

  async add(input: Omit<Task, "status"> & { status?: TaskStatus }): Promise<Task> {
    await this.initialize();
    const existing = await this.list();
    if (existing.some((task) => task.id.toLowerCase() === input.id.toLowerCase())) {
      throw new Error(`Ya existe una tarea con el ID ${input.id}.`);
    }
    const task: Task = { ...input, status: input.status ?? "pendientes" };
    await this.append(task);
    return task;
  }

  async move(id: string, status: TaskStatus): Promise<Task> {
    await this.initialize();
    const all = await this.list();
    const task = all.find((item) => item.id.toLowerCase() === id.toLowerCase());
    if (!task) throw new Error(`No se encontró la tarea ${id}.`);
    if (task.status === status) return task;

    // Escribe el destino antes de retirar el origen para reducir el riesgo de pérdida.
    const updated: Task = { ...task, status };
    await this.append(updated);
    const source = this.parse(await readFile(this.file(task.status), "utf8"));
    await writeFile(this.file(task.status), this.serialize(source.filter((item) => item.id !== task.id)), "utf8");
    return updated;
  }

  private async append(task: Task): Promise<void> {
    const current = await readFile(this.file(task.status), "utf8");
    const separator = current.trim() ? "\n\n" : "";
    await writeFile(this.file(task.status), current.trimEnd() + separator + this.serialize([task]), "utf8");
  }

  private parse(content: string): Task[] {
    const blocks = content.match(/\[TASK\][\s\S]*?\[\/TASK\]/g) ?? [];
    return blocks.map((block) => {
      const values = new Map<string, string>();
      for (const line of block.replace(/^\[TASK\]|\[\/TASK\]$/g, "").trim().split(/\r?\n/)) {
        const index = line.indexOf("=");
        if (index > 0) values.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
      }
      const status = values.get("status") as TaskStatus;
      const priority = values.get("priority") as Task["priority"];
      const task: Task = {
        id: values.get("id") ?? "",
        title: values.get("title") ?? "",
        description: values.get("description") ?? "",
        status,
        priority,
        created: values.get("created") ?? ""
      };
      if (!task.id || !task.title || !STATUSES.includes(status) || !["baja", "media", "alta", "urgente"].includes(priority)) {
        throw new Error("Se encontró una tarea TXT con campos inválidos. Revisa sus datos.");
      }
      return task;
    });
  }

  private serialize(tasks: Task[]): string {
    return tasks.map((task) => [
      "[TASK]",
      `id=${task.id}`,
      `title=${task.title}`,
      `description=${task.description.replace(/\r?\n/g, " ")}`,
      `status=${task.status}`,
      `priority=${task.priority}`,
      `created=${task.created}`,
      "[/TASK]"
    ].join("\n")).join("\n\n");
  }
}
