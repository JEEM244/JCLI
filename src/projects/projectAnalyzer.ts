import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface ProjectAnalysis {
  root: string;
  filesScanned: number;
  languages: Array<{ name: string; files: number }>;
  technologies: string[];
  manifests: string[];
  gitRepository: boolean;
}

const IGNORED = new Set([
  ".git", ".svn", ".hg", "node_modules", "vendor", "dist", "build",
  "coverage", ".next", ".angular", "bin", "obj", ".idea", ".vs"
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
  ".mjs": "JavaScript", ".cjs": "JavaScript", ".php": "PHP", ".py": "Python",
  ".cs": "C#", ".java": "Java", ".kt": "Kotlin", ".html": "HTML", ".css": "CSS",
  ".scss": "SCSS", ".json": "JSON", ".sql": "SQL", ".md": "Markdown",
  ".ps1": "PowerShell", ".psm1": "PowerShell", ".cpp": "C++", ".c": "C",
  ".h": "C/C++", ".hpp": "C++", ".go": "Go", ".rs": "Rust", ".xml": "XML",
  ".yml": "YAML", ".yaml": "YAML", ".sh": "Shell", ".bat": "Batch"
};

const MANIFESTS = new Set([
  "package.json", "composer.json", "requirements.txt", "pyproject.toml",
  "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts",
  "global.json", "Directory.Build.props", "docker-compose.yml",
  "angular.json", "vite.config.ts", "vite.config.js"
]);

export async function analyzeProject(root: string, maxFiles = 2500): Promise<ProjectAnalysis> {
  const counts = new Map<string, number>();
  const manifests = new Set<string>();
  let filesScanned = 0;

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 5 || filesScanned >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (filesScanned >= maxFiles) break;
      if (entry.isDirectory()) {
        if (!IGNORED.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(path.join(directory, entry.name), depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      filesScanned++;
      const lower = entry.name.toLowerCase();
      if (MANIFESTS.has(lower) || lower.endsWith(".csproj") || lower.endsWith(".sln") || lower.endsWith(".slnx")) {
        manifests.add(entry.name);
      }
      const extension = path.extname(lower);
      const language = LANGUAGE_BY_EXTENSION[extension];
      if (language) counts.set(language, (counts.get(language) ?? 0) + 1);

      if (lower === "package.json") {
        try {
          const pkg = JSON.parse(await readFile(path.join(directory, entry.name), "utf8")) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
          };
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          for (const [name, label] of [
            ["@angular/core", "Angular"], ["react", "React"], ["next", "Next.js"],
            ["vue", "Vue"], ["express", "Express"], ["vite", "Vite"],
            ["electron", "Electron"], ["typescript", "TypeScript"]
          ]) {
            if (deps[name]) manifests.add(label);
          }
        } catch {
          // Un manifiesto JSON inválido no debe detener el análisis completo.
        }
      }
    }
  }

  await walk(root, 0);
  const gitRepository = await readdir(root, { withFileTypes: true })
    .then((entries) => entries.some((entry) => entry.isDirectory() && entry.name === ".git"))
    .catch(() => false);

  return {
    root,
    filesScanned,
    languages: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, files]) => ({ name, files })),
    technologies: [...manifests].filter((item) => !MANIFESTS.has(item.toLowerCase())).sort(),
    manifests: [...manifests].filter((item) => MANIFESTS.has(item.toLowerCase()) || /\\.(csproj|sln|slnx)$/i.test(item)).sort(),
    gitRepository
  };
}
