import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Project {
  id: string;
  name: string;
  directory: string;
  description: string;
  created: string;
}

interface ProjectFile {
  projects: Project[];
}

export class ProjectStore {
  constructor(private readonly filePath = path.resolve("data/projects/projects.json")) {}

  private async read(): Promise<ProjectFile> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ProjectFile;
      if (!Array.isArray(parsed.projects)) throw new Error("Formato de registro de proyectos inválido.");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const initial: ProjectFile = { projects: [] };
      await this.write(initial);
      return initial;
    }
  }

  private async write(data: ProjectFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }

  async list(): Promise<Project[]> {
    return (await this.read()).projects;
  }

  async add(project: Project): Promise<void> {
    const data = await this.read();
    if (data.projects.some((item) => item.id.toLowerCase() === project.id.toLowerCase())) {
      throw new Error(`Ya existe un proyecto con el ID ${project.id}.`);
    }
    if (data.projects.some((item) => item.directory.toLowerCase() === project.directory.toLowerCase())) {
      throw new Error("Esa carpeta ya está registrada.");
    }
    data.projects.push(project);
    await this.write(data);
  }

  async get(id: string): Promise<Project | undefined> {
    return (await this.list()).find((item) => item.id.toLowerCase() === id.toLowerCase());
  }
}
