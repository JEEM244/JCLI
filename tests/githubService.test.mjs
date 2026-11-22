import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitHubClient } from "../dist/github/githubClient.js";
import { GitHubService } from "../dist/github/githubService.js";
import { GitHubIssueLinkStore } from "../dist/github/issueLinkStore.js";
import { HistoryStore } from "../dist/history/historyStore.js";

function git(directory, args) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "JCLI Test",
      GIT_AUTHOR_EMAIL: "jcli@example.invalid",
      GIT_COMMITTER_NAME: "JCLI Test",
      GIT_COMMITTER_EMAIL: "jcli@example.invalid",
      GIT_TERMINAL_PROMPT: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-github-"));
  const projectDirectory = path.join(directory, "project");
  await mkdir(projectDirectory, { recursive: true });
  git(projectDirectory, ["init"]);
  git(projectDirectory, ["checkout", "-b", "main"]);
  git(projectDirectory, ["config", "user.name", "JCLI Test"]);
  git(projectDirectory, ["config", "user.email", "jcli@example.invalid"]);
  await writeFile(path.join(projectDirectory, "README.md"), "base\n", "utf8");
  git(projectDirectory, ["add", "README.md"]);
  git(projectDirectory, ["commit", "-m", "Initial"]);
  git(projectDirectory, ["checkout", "-b", "feature/demo"]);
  await writeFile(path.join(projectDirectory, "README.md"), "feature\n", "utf8");
  git(projectDirectory, ["commit", "-am", "Feature"]);
  git(projectDirectory, ["remote", "add", "origin", "https://github.com/acme/site.git"]);
  const headSha = git(projectDirectory, ["rev-parse", "HEAD"]);
  const projects = {
    get: async (id) => id === "WEB"
      ? { id, name: "Web", directory: projectDirectory, description: "", created: "2026-11-22" }
      : undefined
  };
  const tasks = {
    get: async (id) => id === "WEB-001"
      ? { id, title: "Build feature", projectId: "WEB" }
      : undefined
  };
  const state = { writes: [], calls: [] };
  const fetcher = async (url, options = {}) => {
    state.calls.push({ url, method: options.method ?? "GET", headers: options.headers });
    const pathname = new URL(url).pathname;
    const method = options.method ?? "GET";
    const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" }
    });
    const repoData = {
      full_name: "acme/site",
      name: "site",
      private: false,
      html_url: "https://github.com/acme/site",
      default_branch: "main",
      owner: { login: "acme" }
    };
    if (method === "GET" && pathname === "/repos/acme/site") return json(repoData);
    if (method === "GET" && pathname === "/repos/acme/site/branches") {
      return json([
        { name: "main", protected: true, commit: { sha: "base-sha" } },
        { name: "feature/demo", protected: false, commit: { sha: headSha } }
      ]);
    }
    if (method === "GET" && pathname === "/repos/acme/site/branches/feature%2Fdemo") {
      return json({ name: "feature/demo", protected: false, commit: { sha: headSha } });
    }
    if (method === "GET" && pathname === "/repos/acme/site/branches/main") {
      return json({ name: "main", protected: true, commit: { sha: "base-sha" } });
    }
    if (method === "GET" && pathname === "/repos/acme/site/compare/main...feature%2Fdemo") {
      return json({
        status: "ahead",
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        files: [{ filename: "README.md", status: "modified", additions: 1, deletions: 1, changes: 2 }]
      });
    }
    if (method === "GET" && pathname === "/repos/acme/site/pulls") {
      return json([{
        number: 12, title: "Feature", state: "open", html_url: "https://github.com/acme/site/pull/12",
        body: "Details", head: { ref: "feature/demo" }, base: { ref: "main" }, draft: false
      }]);
    }
    if (method === "GET" && pathname === "/repos/acme/site/issues/5") {
      return json({
        number: 5, title: "A task", state: "open", html_url: "https://github.com/acme/site/issues/5",
        body: "Issue body"
      });
    }
    if (method === "POST" && pathname === "/repos/acme/site/pulls") {
      state.writes.push(JSON.parse(options.body));
      return json({
        number: 13, title: "New PR", state: "open", html_url: "https://github.com/acme/site/pull/13",
        body: "description", head: { ref: "feature/demo" }, base: { ref: "main" }, draft: false
      }, 201);
    }
    if (method === "POST" && pathname === "/repos/acme/site/issues") {
      state.writes.push(JSON.parse(options.body));
      return json({
        number: 22, title: "New issue", state: "open", html_url: "https://github.com/acme/site/issues/22",
        body: "description"
      }, 201);
    }
    return json({ message: "Not Found" }, 404);
  };
  const oldWrites = process.env.JCLI_ENABLE_GITHUB_WRITES;
  process.env.JCLI_ENABLE_GITHUB_WRITES = "true";
  const links = new GitHubIssueLinkStore(path.join(directory, "data/issue-links.json"));
  const history = new HistoryStore(path.join(directory, "data/history.jsonl"));
  const client = new GitHubClient("fake-test-token", fetcher);
  return {
    directory,
    projectDirectory,
    headSha,
    state,
    links,
    history,
    service: new GitHubService(projects, tasks, client, links, history),
    restore: () => {
      if (oldWrites === undefined) delete process.env.JCLI_ENABLE_GITHUB_WRITES;
      else process.env.JCLI_ENABLE_GITHUB_WRITES = oldWrites;
    }
  };
}

test("consulta repositorio, ramas, diferencias y Pull Requests", async () => {
  const context = await setup();
  try {
    const repo = await context.service.repository("WEB");
    assert.equal(repo.fullName, "acme/site");
    assert.equal(repo.defaultBranch, "main");

    const branches = await context.service.branches("WEB");
    assert.equal(branches.length, 2);
    assert.equal(branches[1].name, "feature/demo");

    const comparison = await context.service.compare("WEB", "main", "feature/demo");
    assert.equal(comparison.aheadBy, 1);
    assert.equal(comparison.files[0].filename, "README.md");

    const pulls = await context.service.listPullRequests("WEB", "open");
    assert.equal(pulls[0].number, 12);
    assert.equal(pulls[0].head, "feature/demo");
  } finally {
    context.restore();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("crea Pull Requests solo con token, opt-in, --confirm y rama publicada", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () => context.service.createPullRequest("WEB", "main", "Feature PR", "Description", false),
      /--confirm/
    );
    const pr = await context.service.createPullRequest("WEB", "main", "Feature PR", "Description", true);
    assert.equal(pr.number, 13);
    assert.equal(context.state.writes.length, 1);
    assert.equal(context.state.writes[0].head, "acme:feature/demo");
    assert.equal(context.state.writes[0].base, "main");
    assert.ok(context.state.calls.some((item) => item.method === "POST" &&
      item.headers.Authorization === "Bearer fake-test-token"));
    const history = await context.history.list(10);
    assert.ok(history.some((item) => item.action === "github.pr_created"));
  } finally {
    context.restore();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("bloquea Pull Requests cuando hay cambios locales sin publicar", async () => {
  const context = await setup();
  try {
    await writeFile(path.join(context.projectDirectory, "uncommitted.txt"), "local\n", "utf8");
    await assert.rejects(
      () => context.service.createPullRequest("WEB", "main", "Feature PR", "Description", true),
      /cambios locales sin commit/
    );
    assert.equal(context.state.writes.length, 0);
  } finally {
    context.restore();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("bloquea ramas remotas que no coinciden con el commit local", async () => {
  const context = await setup();
  try {
    const changedFetcher = async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" }
      });
      if ((options.method ?? "GET") === "GET" && pathname === "/repos/acme/site") {
        return json({
          full_name: "acme/site", name: "site", private: false,
          html_url: "https://github.com/acme/site", default_branch: "main",
          owner: { login: "acme" }
        });
      }
      if ((options.method ?? "GET") === "GET" && pathname === "/repos/acme/site/branches/feature%2Fdemo") {
        return json({ name: "feature/demo", protected: false, commit: { sha: "different-sha" } });
      }
      if ((options.method ?? "GET") === "GET" && pathname === "/repos/acme/site/branches/main") {
        return json({ name: "main", protected: true, commit: { sha: "base-sha" } });
      }
      return json({ message: "Not Found" }, 404);
    };
    const client = new GitHubClient("fake-test-token", changedFetcher);
    const projectStore = { get: async () => ({ id: "WEB", name: "Web", directory: context.projectDirectory }) };
    const service = new GitHubService(projectStore, {}, client, context.links, context.history);
    await assert.rejects(
      () => service.createPullRequest("WEB", "main", "PR", "Body", true),
      /no coincide con la rama publicada/
    );
  } finally {
    context.restore();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("crea Issues, los vincula a tareas y permite desvincularlos", async () => {
  const context = await setup();
  try {
    const issue = await context.service.createIssue("WEB", "New issue", "Description", true);
    assert.equal(issue.number, 22);
    const link = await context.service.linkIssue("WEB", "WEB-001", 5, true);
    assert.equal(link.issueNumber, 5);
    assert.equal((await context.service.issueLinks("WEB")).length, 1);
    const removed = await context.service.unlinkIssue("WEB", "WEB-001", true);
    assert.equal(removed.issueNumber, 5);
    assert.equal((await context.service.issueLinks("WEB")).length, 0);
  } finally {
    context.restore();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("rechaza vincular un Issue que no pertenece a una tarea del proyecto", async () => {
  const context = await setup();
  try {
    await assert.rejects(
      () => context.service.linkIssue("WEB", "UNKNOWN", 5, true),
      /no existe o no está asociada/
    );
  } finally {
    context.restore();
    await rm(context.directory, { recursive: true, force: true });
  }
});

test("la API no filtra un token en los mensajes de error", async () => {
  const client = new GitHubClient("secret-value", async () =>
    new Response(JSON.stringify({ message: "Invalid token: secret-value" }), { status: 401 })
  );
  await assert.rejects(() => client.get("/repos/acme/site"), (error) => {
    assert.match(error.message, /TOKEN OCULTO/);
    assert.doesNotMatch(error.message, /secret-value/);
    return true;
  });
});

test("bloquea las escrituras si el opt-in local está desactivado", async () => {
  const original = process.env.JCLI_ENABLE_GITHUB_WRITES;
  delete process.env.JCLI_ENABLE_GITHUB_WRITES;
  try {
    const client = new GitHubClient("fake-token", async () => {
      throw new Error("No debería llamar a fetch.");
    });
    await assert.rejects(
      () => client.post("/repos/acme/site/issues", { title: "Issue", body: "" }),
      /desactivadas/
    );
  } finally {
    if (original === undefined) delete process.env.JCLI_ENABLE_GITHUB_WRITES;
    else process.env.JCLI_ENABLE_GITHUB_WRITES = original;
  }
});

test("rechaza remotos que no son de GitHub", async () => {
  const context = await setup();
  try {
    git(context.projectDirectory, ["remote", "set-url", "origin", "https://example.com/acme/site.git"]);
    await assert.rejects(() => context.service.repository("WEB"), /debe ser una URL de GitHub/);
  } finally {
    context.restore();
    await rm(context.directory, { recursive: true, force: true });
  }
});
