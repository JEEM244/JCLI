const API_BASE = "https://api.github.com";
const API_VERSION = "2026-03-10";
const REQUEST_TIMEOUT = 15000;

export class GitHubClient {
  constructor(
    private readonly token = process.env.GITHUB_TOKEN?.trim() ?? "",
    private readonly fetcher: typeof fetch = fetch
  ) {}

  get authenticated(): boolean {
    return Boolean(this.token);
  }

  assertWriteEnabled(): void {
    if (!this.token) {
      throw new Error("Configura GITHUB_TOKEN en tu archivo .env para publicar en GitHub.");
    }
    if (process.env.JCLI_ENABLE_GITHUB_WRITES !== "true") {
      throw new Error("Las operaciones de escritura están desactivadas. Revisa JCLI_ENABLE_GITHUB_WRITES en .env.");
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>("GET", endpoint);
  }

  async post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    this.assertWriteEnabled();
    return this.request<T>("POST", endpoint, body);
  }

  private async request<T>(
    method: "GET" | "POST",
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    let pathSegments: string[];
    try {
      pathSegments = endpoint.split("?")[0].split("/").map((segment) => decodeURIComponent(segment));
    } catch {
      throw new Error("Ruta interna de GitHub inválida.");
    }
    if (!endpoint.startsWith("/repos/") || endpoint.includes("\0") || endpoint.includes("\\") ||
        pathSegments.some((segment) => segment === "." || segment === "..")) {
      throw new Error("Ruta interna de GitHub inválida.");
    }
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "JCLI/0.8"
    };
    if (this.token) headers.Authorization = "Bearer " + this.token;
    if (body) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await this.fetcher(API_BASE + endpoint, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });
      const raw = await response.text();
      let parsed: unknown = {};
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error("GitHub devolvió una respuesta que no es JSON válido.");
        }
      }
      if (!response.ok) {
        const message = typeof parsed === "object" && parsed !== null &&
          "message" in parsed && typeof parsed.message === "string"
          ? parsed.message
          : "GitHub respondió con HTTP " + response.status + ".";
        const safeMessage = this.token
          ? message.split(this.token).join("[TOKEN OCULTO]")
          : message;
        throw new Error(("GitHub HTTP " + response.status + ": " + safeMessage).slice(0, 1200));
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("GitHub no respondió dentro del límite de 15 segundos.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
