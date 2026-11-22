import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { GitHubIssueLink } from "./types.js";

interface LinkFile {
  links: GitHubIssueLink[];
}

export class GitHubIssueLinkStore {
  constructor(private readonly filePath = path.resolve("data/github/issue-links.json")) {}

  private async read(): Promise<LinkFile> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as LinkFile;
      if (!Array.isArray(parsed.links)) throw new Error("Registro de vínculos GitHub inválido.");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { links: [] };
    }
  }

  private async write(data: LinkFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = this.filePath + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx"
      });
      await rename(temporary, this.filePath);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async list(projectId: string): Promise<GitHubIssueLink[]> {
    return (await this.read()).links
      .filter((item) => item.projectId.toLowerCase() === projectId.toLowerCase())
      .sort((a, b) => a.taskId.localeCompare(b.taskId));
  }

  async get(projectId: string, taskId: string): Promise<GitHubIssueLink | undefined> {
    return (await this.read()).links.find((item) =>
      item.projectId.toLowerCase() === projectId.toLowerCase() &&
      item.taskId.toLowerCase() === taskId.toLowerCase()
    );
  }

  async link(item: GitHubIssueLink): Promise<void> {
    const data = await this.read();
    const existing = data.links.find((entry) =>
      entry.projectId.toLowerCase() === item.projectId.toLowerCase() &&
      entry.taskId.toLowerCase() === item.taskId.toLowerCase()
    );
    if (existing) throw new Error("La tarea ya tiene un Issue vinculado. Desvincúlalo antes de cambiarlo.");
    const sameIssue = data.links.find((entry) =>
      entry.projectId.toLowerCase() === item.projectId.toLowerCase() &&
      entry.issueNumber === item.issueNumber
    );
    if (sameIssue) throw new Error("Ese Issue ya está vinculado a otra tarea del proyecto.");
    data.links.push(item);
    await this.write(data);
  }

  async unlink(projectId: string, taskId: string): Promise<GitHubIssueLink | undefined> {
    const data = await this.read();
    const existing = data.links.find((entry) =>
      entry.projectId.toLowerCase() === projectId.toLowerCase() &&
      entry.taskId.toLowerCase() === taskId.toLowerCase()
    );
    if (!existing) return undefined;
    data.links = data.links.filter((entry) => entry !== existing);
    await this.write(data);
    return existing;
  }
}
