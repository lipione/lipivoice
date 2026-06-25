import type { LlmAdapter, RuntimeHealthResult } from "./types";
import { getGoogleAccessToken, googleUserProjectHeader, readGoogleServiceAccount, type GoogleServiceAccount } from "./googleAuth";
import { mapRuntimeHealth } from "./health";

interface GoogleGeminiAdapterOptions {
  credentialsPath: string;
  modelName?: string;
  endpoint?: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface GoogleGeminiModelsResponse {
  models?: Array<{ name?: string }>;
}

interface GoogleGeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    status?: string;
    message?: string;
  };
}

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

export class GoogleGeminiAdapter implements LlmAdapter {
  private readonly credentialsPath: string;
  private readonly modelName: string;
  private readonly endpoint: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private token: TokenCache | null = null;

  constructor(options: GoogleGeminiAdapterOptions) {
    this.credentialsPath = options.credentialsPath;
    this.modelName = options.modelName ?? "gemini-2.5-flash";
    this.endpoint = (options.endpoint ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    this.apiVersion = options.apiVersion ?? "v1beta";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async health(): Promise<RuntimeHealthResult> {
    const credentials = await readGoogleServiceAccount(this.credentialsPath);
    if (!credentials) {
      return { status: "missing_model", reason: "runtime_not_configured" };
    }

    if (!this.modelName) {
      return { status: "missing_model", reason: "model_not_configured" };
    }

    try {
      const token = await this.getAccessToken(credentials);
      const startedAt = performance.now();

      const response = await this.fetchImpl(`${this.endpoint}/${this.apiVersion}/models`, {
        headers: {
          authorization: `Bearer ${token}`,
          ...googleUserProjectHeader(credentials),
        },
      });

      const latencyMs = Math.round(performance.now() - startedAt);
      if (!response.ok) {
        return mapRuntimeHealth({ configured: true, reachable: false, modelPresent: false, latencyMs });
      }

      const body = (await response.json()) as GoogleGeminiModelsResponse;
      const configuredModelName = normalizeModelName(this.modelName);
      const modelPresent =
        body.models?.some((model) => model.name === configuredModelName || model.name?.endsWith(`/${configuredModelName}`)) ??
        false;

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
    const credentials = await readGoogleServiceAccount(this.credentialsPath);
    if (!credentials) {
      throw new Error("Google Gemini credentials are not configured");
    }

    const configuredModelName = normalizeModelName(input.model || this.modelName);
    if (!configuredModelName) {
      throw new Error("Google Gemini model is not configured");
    }

    const token = await this.getAccessToken(credentials);
    const response = await this.fetchImpl(
      `${this.endpoint}/${this.apiVersion}/models/${encodeURIComponent(configuredModelName)}:generateContent`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          ...googleUserProjectHeader(credentials),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: input.messages.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            temperature: 0.2,
            topP: 0.9,
            maxOutputTokens: 512,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Google Gemini chat failed with status ${response.status}`);
    }

    const body = (await response.json()) as GoogleGeminiGenerateResponse;
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (typeof text === "string" && text.length > 0) {
      return text;
    }

    throw new Error(
      `Google Gemini response did not include text ${body.error ? `(${body.error.status ?? "error"}: ${body.error.message ?? ""})` : ""}`.trim(),
    );
  }

  private async getAccessToken(credentials: GoogleServiceAccount) {
    const result = await getGoogleAccessToken({
      credentials,
      fetchImpl: this.fetchImpl,
      now: this.now,
      tokenCache: this.token,
    });

    this.token = result.tokenCache;
    return result.token;
  }
}

function normalizeModelName(modelName: string): string {
  return modelName.startsWith("google:") ? modelName.replace(/^google:/, "") : modelName;
}
