import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AgentRegistry } from "../dist/agents/agentRegistry.js";
import { TeamCoordinator } from "../dist/agents/teamCoordinator.js";
import { TeamRunStore } from "../dist/agents/runStore.js";

function definitions() {
  return {
    limits: {
      maxAgentsPerRun: 3,
      maxFilesPerRun: 2,
      maxFileBytes: 5000,
      maxContextCharacters: 3000
    },
    agents: [
      {
        id: "planner", name: "Planificador", provider: "openai",
        purpose: "Planifica", systemPrompt: "Planifica con cuidado.",
        enabled: true, maxOutputTokens: 100
      },
      {
        id: "reviewer", name: "Revisor", provider: "anthropic",
        purpose: "Revisa", systemPrompt: "Revisa con cuidado.",
        enabled: true, maxOutputTokens: 100
      }
    ]
  };
}

test("prepara y ejecuta agentes en orden, comparte resultados y registra la revisión", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jcli-team-"));
  const previousTeam = process.env.JCLI_ENABLE_TEAM_RUNS;
  const previousApi = process.env.JCLI_ENABLE_API_CALLS;
  const prompts = [];
  const events = [];
  try {
    const projectDirectory = path.join(directory, "project");
    await (await import("node:fs/promises")).mkdir(projectDirectory);
    await writeFile(path.join(projectDirectory, "README.md"), "Proyecto de prueba", "utf8");
    const configPath = path.join(directory, "agents.json");
    await writeFile(configPath, JSON.stringify(definitions()), "utf8");

    const task = {
      id: "TASK-1",
      title: "Revisar el proyecto",
      description: "Analiza la estructura y sugiere mejoras.",
      status: "pendientes",
      priority: "media",
      created: "2026-11-20",
      projectId: "PROJECT-1",
      agentIds: ["planner", "reviewer"]
    };
    const tasks = { get: async (id) => id === task.id ? task : undefined };
    const projects = {
      get: async (id) => id === "PROJECT-1"
        ? { id, name: "Proyecto de prueba", directory: projectDirectory }
        : undefined
    };
    const ai = {
      ask: async (provider, prompt, options) => {
        prompts.push({ provider, prompt, options });
        return { model: "mock-model", text: "Propuesta de " + provider };
      }
    };
    const registry = new AgentRegistry(pathToFileURL(configPath));
    const runs = new TeamRunStore(path.join(directory, "runs"));
    const history = {
      record: async (...args) => { events.push(args); }
    };
    const coordinator = new TeamCoordinator(tasks, projects, ai, registry, runs, history);

    const plan = await coordinator.plan(task.id, ["README.md"]);
    assert.equal(plan.estimatedRequests, 2);
    assert.deepEqual(plan.files, ["README.md"]);
    assert.equal(prompts.length, 0);

    process.env.JCLI_ENABLE_TEAM_RUNS = "true";
    process.env.JCLI_ENABLE_API_CALLS = "true";
    const run = await coordinator.run(task.id, ["README.md"]);
    assert.equal(run.status, "completed");
    assert.equal(run.agents.length, 2);
    assert.equal(prompts[0].provider, "openai");
    assert.equal(prompts[1].provider, "anthropic");
    assert.match(prompts[1].prompt, /Propuesta de openai/);
    assert.equal(prompts[0].options.systemPrompt, "Planifica con cuidado.");
    assert.equal((await coordinator.getRun(run.id)).status, "completed");

    await coordinator.decide(run.id, "accepted");
    assert.equal((await coordinator.getRun(run.id)).decision, "accepted");
    assert.equal(events.length, 2);
    assert.equal(await readFile(path.join(projectDirectory, "README.md"), "utf8"), "Proyecto de prueba");
  } finally {
    if (previousTeam === undefined) delete process.env.JCLI_ENABLE_TEAM_RUNS;
    else process.env.JCLI_ENABLE_TEAM_RUNS = previousTeam;
    if (previousApi === undefined) delete process.env.JCLI_ENABLE_API_CALLS;
    else process.env.JCLI_ENABLE_API_CALLS = previousApi;
    await rm(directory, { recursive: true, force: true });
  }
});

test("no ejecuta agentes si el segundo permiso está desactivado", async () => {
  const previousTeam = process.env.JCLI_ENABLE_TEAM_RUNS;
  const previousApi = process.env.JCLI_ENABLE_API_CALLS;
  delete process.env.JCLI_ENABLE_TEAM_RUNS;
  process.env.JCLI_ENABLE_API_CALLS = "true";
  try {
    const coordinator = new TeamCoordinator(
      { get: async () => undefined },
      { get: async () => undefined },
      { ask: async () => { throw new Error("No debe llamarse"); } }
    );
    await assert.rejects(() => coordinator.run("TASK-1"), /JCLI_ENABLE_TEAM_RUNS/);
  } finally {
    if (previousTeam === undefined) delete process.env.JCLI_ENABLE_TEAM_RUNS;
    else process.env.JCLI_ENABLE_TEAM_RUNS = previousTeam;
    if (previousApi === undefined) delete process.env.JCLI_ENABLE_API_CALLS;
    else process.env.JCLI_ENABLE_API_CALLS = previousApi;
  }
});
