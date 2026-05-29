import { mapRuntimeHealth } from "./health";
import type { LlmAdapter, RuntimeHealthResult } from "./types";

interface OpenAICompatibleAdapterOptions {
  baseUrl: string;
  model?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: string }>;
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export class OpenAICompatibleAdapter implements LlmAdapter {
  private readonly baseUrl: string;
  private readonly model: string | null;
  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.model = options.model?.trim() || null;
    this.apiKey = options.apiKey?.trim() || null;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<RuntimeHealthResult> {
    if (!this.baseUrl) {
      return mapRuntimeHealth({ configured: false, reachable: false, modelPresent: false });
    }

    const startedAt = performance.now();

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/models`, {
        headers: this.headers(),
      });
      const latencyMs = Math.round(performance.now() - startedAt);

      if (!response.ok) {
        return mapRuntimeHealth({ configured: true, reachable: false, modelPresent: false, latencyMs });
      }

      const body = (await response.json()) as OpenAIModelsResponse;
      const modelPresent = this.model === null || body.data?.some((model) => model.id === this.model) === true;

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
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...this.headers(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "system", content: input.system }, ...input.messages],
        stream: false,
        temperature: 0.2,
        max_tokens: 512,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible chat failed with status ${response.status}`);
    }

    const body = (await response.json()) as OpenAIChatResponse;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content;
    }

    throw new Error("OpenAI-compatible chat response did not include message content");
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }
}
