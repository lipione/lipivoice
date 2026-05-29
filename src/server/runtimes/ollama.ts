import { mapRuntimeHealth } from "./health";
import type { LlmAdapter, RuntimeHealthResult } from "./types";

interface OllamaAdapterOptions {
  baseUrl: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaChatResponse {
  message?: { content?: string };
  response?: string;
}

export class OllamaAdapter implements LlmAdapter {
  private readonly baseUrl: string;
  private readonly model: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.model = options.model?.trim() || null;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<RuntimeHealthResult> {
    if (!this.baseUrl) {
      return mapRuntimeHealth({ configured: false, reachable: false, modelPresent: false });
    }

    const startedAt = performance.now();

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/tags`);
      const latencyMs = Math.round(performance.now() - startedAt);

      if (!response.ok) {
        return mapRuntimeHealth({ configured: true, reachable: false, modelPresent: false, latencyMs });
      }

      const tags = (await response.json()) as OllamaTagsResponse;
      const modelPresent =
        this.model === null ||
        tags.models?.some((model) => model.name === this.model || model.model === this.model) === true;

      return mapRuntimeHealth({ configured: true, reachable: true, modelPresent, latencyMs });
    } catch {
      return mapRuntimeHealth({ configured: true, reachable: false, modelPresent: false });
    }
  }

  async chat(input: {
    model: string;
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "system", content: input.system }, ...input.messages],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat failed with status ${response.status}`);
    }

    const body = (await response.json()) as OllamaChatResponse;
    return body.message?.content ?? body.response ?? "";
  }
}
