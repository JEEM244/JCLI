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
      maxAgentsPerRun: 4,
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
        id: "implementer", name: "Implementador", provider: "deepseek",
        purpose: "Propone cambios", systemPrompt: "Propón cambios con cuidado.",
        enabled: true, maxOutputTokens: 100
      },
      {
        id: "reviewer", name: "Revisor", provider: "anthropic",
        purpose: "Revisa", systemPrompt: "Revisa con cuidado.",
        enabled: true, maxOutputTokens: 100
      },
      {
        id: "tester", name: "Analista de pruebas", provider: "gemini",
        purpose: "Diseña pruebas", systemPrompt: "Diseña pruebas con cuidado.",
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
      agentIds: ["planner", "implementer", "reviewer", "tester"]
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
    const memory = {
      get: async (projectId) => ({
        projectId,
        updatedAt: "2026-11-22T12:00:00.000Z",
        summary: "Aplicación web con API independiente.",
        notes: [{ id: "note-1", content: "Mantener rutas REST consistentes.", createdAt: "" }],
        decisions: [{ id: "decision-1", title: "Persistencia", decision: "Usar MySQL.", createdAt: "" }],
        structure: { generatedAt: "", filesScanned: 12, languages: [], technologies: ["PHP"], manifests: [], gitRepository: true }
      }),
      getContext: async () => "REGLA HISTÓRICA: usar endpoints REST versionados."
    };
    const coordinator = new TeamCoordinator(tasks, projects, ai, registry, runs, history, memory);

    const plan = await coordinator.plan(task.id, ["README.md"]);
    assert.equal(plan.estimatedRequests, 4);
    assert.deepEqual(plan.files, ["README.md"]);
    assert.equal(plan.memorySummary, true);
    assert.equal(plan.memoryNotes, 1);
    assert.equal(plan.memoryDecisions, 1);
    assert.equal(plan.memoryStructure, true);
    assert.equal(prompts.length, 0);

    process.env.JCLI_ENABLE_TEAM_RUNS = "true";
    process.env.JCLI_ENABLE_API_CALLS = "true";
    const run = await coordinator.run(task.id, ["README.md"]);
    assert.equal(run.status, "completed");
    assert.equal(run.agents.length, 4);
    assert.equal(prompts[0].provider, "openai");
    assert.equal(prompts[1].provider, "deepseek");
    assert.equal(prompts[2].provider, "anthropic");
    assert.equal(prompts[3].provider, "gemini");
    assert.match(prompts[0].prompt, /REGLA HISTÓRICA: usar endpoints REST versionados/);
    assert.match(prompts[1].prompt, /REGLA HISTÓRICA/);
    assert.match(prompts[1].prompt, /Propuesta de openai/);
    assert.match(prompts[2].prompt, /Propuesta de deepseek/);
    assert.match(prompts[3].prompt, /Propuesta de anthropic/);
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
