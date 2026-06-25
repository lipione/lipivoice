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
        max_tokens: 96,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible chat failed with status ${response.status}`);
    }

    const body = (await response.json()) as OpenAIChatResponse;
    const content = body.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return guardUnsupportedPolicyStatus(removeRepeatedSentenceLoop(content), input.messages);
    }

    throw new Error("OpenAI-compatible chat response did not include message content");
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }
}

function removeRepeatedSentenceLoop(content: string): string {
  const text = content.trim();
  if (!text) {
    return text;
  }

  const sentences = text
    .split(/(?<=[।.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length < 3) {
    return text;
  }

  const compacted: string[] = [];
  for (const sentence of sentences) {
    if (compacted.at(-1) === sentence && compacted.at(-2) === sentence) {
      break;
    }
    compacted.push(sentence);
  }

  return compacted.join(" ");
}

function guardUnsupportedPolicyStatus(
  content: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string {
  const latestUserText = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  if (!asksAboutPolicyStatus(latestUserText) || !claimsUnsupportedPolicyStatus(content)) {
    return content;
  }

  const policyNumber = extractPolicyNumber(latestUserText) ?? extractPolicyNumber(content);
  if (policyNumber) {
    return `हस्, पोलिसी नं ${policyNumber} नोट गरिएको छ। स्थिति पुष्टि गर्न स्टाफले सिस्टममा जाँच गर्छन्, कृपया नाम र फोन नम्बर दिनुहोस्।`;
  }

  return "हस्, स्थिति पुष्टि गर्न स्टाफले सिस्टममा जाँच गर्छन्। कृपया पोलिसी नम्बर, नाम र फोन नम्बर दिनुहोस्।";
}

function asksAboutPolicyStatus(text: string): boolean {
  const lower = text.toLowerCase();
  const asksStatus = /status|active|inactive|स्थिती|स्थिति|अवस्था|सक्रिय|निष्क्रिय/u.test(lower);
  const mentionsPolicy = /policy|insurance|पोलिसी|पालिसी|बीमा|इन्स्योरेन्स/u.test(lower);
  return asksStatus && mentionsPolicy;
}

function claimsUnsupportedPolicyStatus(text: string): boolean {
  const lower = text.toLowerCase();
  return /active|inactive|expired|pending|approved|rejected|सक्रिय|निष्क्रिय|समाप्त|म्याद|पेन्डिङ|स्वीकृत|अस्वीकृत/u.test(
    lower,
  );
}

function extractPolicyNumber(text: string): string | null {
  const policyMatch = text.match(/(?:policy|पोलिसी|पालिसी)[^\p{N}\p{L}]*([A-Za-z0-9०-९][A-Za-z0-9०-९ -]{1,24})/iu);
  const fallbackMatch = text.match(/[0-9०-९][0-9०-९ -]{1,24}/u);
  const value = (policyMatch?.[1] ?? fallbackMatch?.[0])?.trim().replace(/\s+/g, " ");
  return value || null;
}
