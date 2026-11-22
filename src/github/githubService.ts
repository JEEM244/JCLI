import { spawn } from "node:child_process";
import { ProjectStore } from "../projects/projectStore.js";
import { TaskStore } from "../tasks/taskStore.js";
import { HistoryStore } from "../history/historyStore.js";
import { GitHubClient } from "./githubClient.js";
import { GitHubIssueLinkStore } from "./issueLinkStore.js";
import type {
  GitHubBranch,
  GitHubComparison,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepository
} from "./types.js";

interface ApiRepository {
  full_name: string;
  name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
  owner: { login: string };
}

interface ApiBranch {
  name: string;
  protected: boolean;
  commit: { sha: string };
}

interface ApiPull {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  head: { ref: string };
  base: { ref: string };
  draft?: boolean;
}

interface ApiIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  pull_request?: { url: string };
}

interface ApiCompare {
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
}

interface OriginRepository {
  owner: string;
  name: string;
}

const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

function validateBranchName(name: string): void {
  if (!name || name.length > 100 || name.startsWith("-") ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) ||
      name.includes("..") || name.includes("//") ||
      name.endsWith("/") || name.endsWith(".") ||
      name.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))) {
    throw new Error("Nombre de rama inválido.");
  }
}

function repositoryPath(owner: string, name: string): string {
  if (!SAFE_NAME.test(owner) || !SAFE_NAME.test(name) || owner === "." || name === ".") {
    throw new Error("El remoto no contiene un repositorio GitHub válido.");
  }
  return "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name);
}

function parseOrigin(remote: string): OriginRepository {
  const trimmed = remote.trim();
  let match = trimmed.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
  if (!match) {
    match = trimmed.match(/^git@github\.com:([^/]+)\/([^/?#]+?)(?:\.git)?$/i);
  }
  if (!match) {
    throw new Error("El remoto origin debe ser una URL de GitHub en HTTPS o SSH. No se admiten otros hosts ni credenciales en la URL.");
  }
  const owner = match[1];
  const name = match[2];
  if (!SAFE_NAME.test(owner) || !SAFE_NAME.test(name)) {
    throw new Error("El remoto origin contiene un nombre no válido.");
  }
  return { owner, name };
}

export class GitHubService {
  constructor(
    private readonly projects = new ProjectStore(),
    private readonly tasks = new TaskStore(),
    private readonly client = new GitHubClient(),
    private readonly links = new GitHubIssueLinkStore(),
    private readonly history = new HistoryStore()
  ) {}

  async repository(projectId: string): Promise<GitHubRepository> {
    const { repositoryPath: endpoint } = await this.getOrigin(projectId);
    const raw = await this.client.get<ApiRepository>(endpoint);
    return {
      owner: raw.owner.login,
      name: raw.name,
      fullName: raw.full_name,
      defaultBranch: raw.default_branch,
      htmlUrl: raw.html_url,
      private: raw.private
    };
  }

  async branches(projectId: string): Promise<GitHubBranch[]> {
    const { endpoint } = await this.getOrigin(projectId);
    const raw = await this.client.get<ApiBranch[]>(endpoint + "/branches?per_page=100");
    return raw.map((branch) => ({
      name: branch.name,
      sha: branch.commit.sha,
      protected: branch.protected
    }));
  }

  async compare(projectId: string, base: string, head: string): Promise<GitHubComparison> {
    validateBranchName(base);
    validateBranchName(head);
    const { endpoint } = await this.getOrigin(projectId);
    const raw = await this.client.get<ApiCompare>(
      endpoint + "/compare/" + encodeURIComponent(base) + "..." + encodeURIComponent(head)
    );
    return {
      status: raw.status,
      aheadBy: raw.ahead_by,
      behindBy: raw.behind_by,
      totalCommits: raw.total_commits,
      files: (raw.files ?? []).map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes
      }))
    };
  }

  async listPullRequests(projectId: string, state: "open" | "closed" | "all" = "open"): Promise<GitHubPullRequest[]> {
    const { endpoint } = await this.getOrigin(projectId);
    const raw = await this.client.get<ApiPull[]>(endpoint + "/pulls?state=" + state + "&per_page=30");
    return raw.map((item) => this.mapPull(item));
  }

  async getPullRequest(projectId: string, number: number): Promise<GitHubPullRequest> {
    this.validateNumber(number, "Pull Request");
    const { endpoint } = await this.getOrigin(projectId);
    const raw = await this.client.get<ApiPull>(endpoint + "/pulls/" + number);
    return this.mapPull(raw);
  }

  async createPullRequest(
    projectId: string,
    base: string,
    title: string,
    body: string,
    confirmed: boolean
  ): Promise<GitHubPullRequest> {
    this.requireConfirmation(confirmed, "Crear un Pull Request");
    this.client.assertWriteEnabled();
    validateBranchName(base);
    this.validateText(title, "El título", 256);
    if (body.length > 65536) throw new Error("La descripción del Pull Request es demasiado larga.");

    const { endpoint, owner } = await this.getOrigin(projectId);
    const [repo, local] = await Promise.all([
      this.client.get<ApiRepository>(endpoint),
      this.localBranchState(projectId)
    ]);
    if (!local.branch) throw new Error("No se puede crear un Pull Request desde HEAD separado.");
    if (!local.clean) throw new Error("Hay cambios locales sin commit. Guarda o resuelve esos cambios antes de crear el Pull Request.");
    if (local.branch === base) throw new Error("La rama de origen y la rama base no pueden ser iguales.");

    const [headBranch, baseBranch] = await Promise.all([
      this.getBranch(endpoint, local.branch),
      this.getBranch(endpoint, base)
    ]);
    if (headBranch.commit.sha !== local.sha) {
      throw new Error("La rama local no coincide con la rama publicada en GitHub. Publica la rama manualmente y vuelve a comparar.");
    }
    if (!baseBranch.commit.sha) throw new Error("No se pudo verificar la rama base.");

    const created = await this.client.post<ApiPull>(endpoint + "/pulls", {
      title,
      body,
      head: owner + ":" + local.branch,
      base,
      maintainer_can_modify: false,
      draft: false
    });
    const result = this.mapPull(created);
    await this.history.record("github.pr_created", String(result.number),
      "Pull Request creado en " + repo.full_name + ": " + result.title);
    return result;
  }

  async listIssues(projectId: string, state: "open" | "closed" | "all" = "open"): Promise<GitHubIssue[]> {
    const { endpoint } = await this.getOrigin(projectId);
    const raw = await this.client.get<ApiIssue[]>(endpoint + "/issues?state=" + state + "&per_page=30");
    return raw.map((item) => this.mapIssue(item)).filter((item) => !item.isPullRequest);
  }

  async getIssue(projectId: string, number: number): Promise<GitHubIssue> {
    this.validateNumber(number, "Issue");
    const { endpoint } = await this.getOrigin(projectId);
    const raw = await this.client.get<ApiIssue>(endpoint + "/issues/" + number);
    return this.mapIssue(raw);
  }

  async createIssue(projectId: string, title: string, body: string, confirmed: boolean): Promise<GitHubIssue> {
    this.requireConfirmation(confirmed, "Crear un Issue");
    this.client.assertWriteEnabled();
    this.validateText(title, "El título", 256);
    if (body.length > 65536) throw new Error("La descripción del Issue es demasiado larga.");
    const { endpoint } = await this.getOrigin(projectId);
    const created = await this.client.post<ApiIssue>(endpoint + "/issues", { title, body });
    const issue = this.mapIssue(created);
    await this.history.record("github.issue_created", String(issue.number),
      "Issue creado: " + issue.title);
    return issue;
  }

  async linkIssue(projectId: string, taskId: string, issueNumber: number, confirmed: boolean) {
    this.requireConfirmation(confirmed, "Vincular un Issue a una tarea");
    this.validateNumber(issueNumber, "Issue");
    const project = await this.projects.get(projectId);
    if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
    const task = await this.tasks.get(taskId);
    if (!task || task.projectId?.toLowerCase() !== project.id.toLowerCase()) {
      throw new Error("La tarea no existe o no está asociada a este proyecto.");
    }
    const issue = await this.getIssue(projectId, issueNumber);
    if (issue.isPullRequest) throw new Error("El número indicado corresponde a un Pull Request, no a un Issue.");
    const link = {
      projectId: project.id,
      taskId: task.id,
      issueNumber: issue.number,
      issueUrl: issue.htmlUrl,
      createdAt: new Date().toISOString()
    };
    await this.links.link(link);
    await this.history.record("github.issue_linked", task.id,
      "Tarea vinculada con el Issue #" + issue.number);
    return link;
  }

  async unlinkIssue(projectId: string, taskId: string, confirmed: boolean) {
    this.requireConfirmation(confirmed, "Desvincular un Issue");
    const link = await this.links.unlink(projectId, taskId);
    if (!link) throw new Error("La tarea no tiene un Issue vinculado.");
    await this.history.record("github.issue_unlinked", taskId,
      "Issue #" + link.issueNumber + " desvinculado");
    return link;
  }

  async issueLinks(projectId: string) {
    const project = await this.projects.get(projectId);
    if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
    return this.links.list(project.id);
  }

  private async getOrigin(projectId: string): Promise<{
    endpoint: string;
    repositoryPath: string;
    owner: string;
    name: string;
  }> {
    const project = await this.projects.get(projectId);
    if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
    const remote = await this.runGit(project.directory, ["remote", "get-url", "origin"]);
    const parsed = parseOrigin(remote);
    const endpoint = repositoryPath(parsed.owner, parsed.name);
    return {
      endpoint,
      repositoryPath: endpoint,
      owner: parsed.owner,
      name: parsed.name
    };
  }

  private async getBranch(endpoint: string, branchName: string): Promise<ApiBranch> {
    return this.client.get<ApiBranch>(endpoint + "/branches/" + encodeURIComponent(branchName));
  }

  private async localBranchState(projectId: string): Promise<{ branch: string; sha: string; clean: boolean }> {
    const project = await this.projects.get(projectId);
    if (!project) throw new Error("No se encontró el proyecto " + projectId + ".");
    const [branch, sha, status] = await Promise.all([
      this.runGit(project.directory, ["branch", "--show-current"]),
      this.runGit(project.directory, ["rev-parse", "HEAD"]),
      this.runGit(project.directory, ["status", "--porcelain", "--untracked-files=all"])
    ]);
    return { branch: branch.trim(), sha: sha.trim(), clean: status.trim().length === 0 };
  }

  private async runGit(directory: string, args: string[]): Promise<string> {
    const environment: NodeJS.ProcessEnv = { ...process.env };
    const blocked = /^(?:GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_COMMON_DIR|GIT_CONFIG|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_CONFIG_NOSYSTEM|GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+|GIT_CEILING_DIRECTORIES|GIT_DISCOVERY_ACROSS_FILESYSTEM)$/i;
    const sensitive = /(API[_-]?KEY|ACCESS[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE[_-]?KEY|AUTH)/i;
    for (const key of Object.keys(environment)) {
      if (blocked.test(key) || sensitive.test(key)) delete environment[key];
    }
    environment.GIT_TERMINAL_PROMPT = "0";
    environment.GIT_PAGER = "cat";
    environment.PAGER = "cat";
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn("git", args, {
        cwd: directory,
        shell: false,
        windowsHide: true,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error("La consulta Git superó el límite de 10 segundos."));
      }, 10000);
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = (stdout + chunk.toString("utf8")).slice(0, 10000);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(0, 3000);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("No se pudo iniciar Git: " + error.message));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) reject(new Error(stderr.trim() || "Falló una consulta Git local."));
        else resolve(stdout.trim());
      });
    });
  }

  private mapPull(item: ApiPull): GitHubPullRequest {
    return {
      number: item.number,
      title: item.title,
      state: item.state,
      htmlUrl: item.html_url,
      body: item.body ?? "",
      head: item.head.ref,
      base: item.base.ref,
      draft: Boolean(item.draft)
    };
  }

  private mapIssue(item: ApiIssue): GitHubIssue {
    return {
      number: item.number,
      title: item.title,
      state: item.state,
      htmlUrl: item.html_url,
      body: item.body ?? "",
      isPullRequest: Boolean(item.pull_request)
    };
  }

  private requireConfirmation(confirmed: boolean, action: string): void {
    if (!confirmed) throw new Error(action + " requiere --confirm.");
  }

  private validateNumber(number: number, label: string): void {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("Número de " + label + " inválido.");
  }

  private validateText(value: string, label: string, maxLength: number): void {
    if (!value || value.trim() !== value || value.length > maxLength || /[\0]/.test(value)) {
      throw new Error(label + " debe ser válido y no superar " + maxLength + " caracteres.");
    }
  }
}
