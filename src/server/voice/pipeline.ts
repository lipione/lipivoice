import type { Tool } from "@/domain/types";
import type { ToolExecutionResult } from "@/server/tools/executor";

interface VoicePipelineAgent {
  greeting: string;
  systemPrompt: string;
  language: string;
  modelAssetId: string;
  voiceId: string;
  toolIds?: string[];
}

interface VoicePipelineMessage {
  role: "user" | "assistant";
  content: string;
}

type VoicePipelineEvent =
  | {
      type: "transcript";
      actor: "user";
      payload: { text: string; confidence: number | null };
    }
  | {
      type: "transcript";
      actor: "assistant";
      payload: { text: string };
    }
  | {
      type: "tool_call";
      actor: "tool";
      payload: {
        toolId: string;
        toolName: string;
        arguments: Record<string, unknown>;
        ok: boolean;
        status: number;
        attempts: number;
        durationMs: number;
        error?: string;
        request: ToolExecutionResult["request"];
        response: ToolExecutionResult["response"];
      };
    }
  | {
      type: "audio";
      actor: "assistant";
      payload: { audioBase64: string; mimeType: string; providerId?: string; voiceId?: string };
    };

interface VoicePipelineInput {
  agent: VoicePipelineAgent;
  model: string;
  audioWavPath: string;
  stt: {
    transcribe(args: { wavPath: string; language: string }): Promise<{ text: string; confidence: number | null }>;
  };
  llm: {
    chat(args: { model: string; system: string; messages: VoicePipelineMessage[] }): Promise<string>;
  };
  tts: {
    synthesize(args: { text: string; voicePath: string }): Promise<{ audioBase64: string; mimeType: string }>;
  };
  history: VoicePipelineMessage[];
  tools?: Tool[];
  toolExecutor?: (tool: Tool, args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

export class NoSpeechDetectedError extends Error {
  constructor() {
    super("Transcription did not include any speech");
    this.name = "NoSpeechDetectedError";
  }
}

export function isNoSpeechDetectedError(error: unknown): error is NoSpeechDetectedError {
  return error instanceof NoSpeechDetectedError ||
    (error instanceof Error && error.name === "NoSpeechDetectedError");
}

export async function runVoiceTurn(input: VoicePipelineInput) {
  const transcription = await input.stt.transcribe({
    wavPath: input.audioWavPath,
    language: input.agent.language,
  });

  if (transcription.text.trim().length === 0) {
    throw new NoSpeechDetectedError();
  }

  const userMessage = { role: "user" as const, content: transcription.text };
  const assignedTools = assignedToolsForAgent(input.agent, input.tools ?? []);
  const systemPrompt = systemPromptWithTools(input.agent.systemPrompt, assignedTools);
  const firstAssistantText = await input.llm.chat({
    model: input.model,
    system: systemPrompt,
    messages: [...input.history, userMessage],
  });
  const toolRequest = parseToolRequest(firstAssistantText);
  const tool = toolRequest
    ? assignedTools.find((candidate) => candidate.id === toolRequest.toolId)
    : null;
  const toolResult = tool && input.toolExecutor
    ? await input.toolExecutor(tool, toolRequest?.arguments ?? {})
    : null;
  const assistantText = toolResult
    ? await input.llm.chat({
        model: input.model,
        system: systemPrompt,
        messages: [
          ...input.history,
          userMessage,
          { role: "assistant", content: firstAssistantText },
          { role: "user", content: toolResultMessage(toolResult) },
        ],
      })
    : firstAssistantText;
  const audio = await input.tts.synthesize({
    text: assistantText,
    voicePath: input.agent.voiceId,
  });
  const events: VoicePipelineEvent[] = [
    {
      type: "transcript" as const,
      actor: "user" as const,
      payload: { text: transcription.text, confidence: transcription.confidence },
    },
  ];

  if (toolResult && toolRequest) {
    events.push({
      type: "tool_call" as const,
      actor: "tool" as const,
      payload: {
        toolId: toolResult.toolId,
        toolName: toolResult.toolName,
        arguments: toolRequest.arguments,
        ok: toolResult.ok,
        status: toolResult.status,
        attempts: toolResult.attempts,
        durationMs: toolResult.durationMs,
        error: toolResult.error,
        request: toolResult.request,
        response: toolResult.response,
      },
    });
  }

  events.push(
    { type: "transcript" as const, actor: "assistant" as const, payload: { text: assistantText } },
    { type: "audio" as const, actor: "assistant" as const, payload: audio },
  );

  return {
    userText: transcription.text,
    assistantText,
    audio,
    events,
  };
}

function assignedToolsForAgent(agent: VoicePipelineAgent, tools: Tool[]) {
  const allowedIds = new Set(agent.toolIds ?? []);

  return tools.filter((tool) => allowedIds.has(tool.id));
}

function systemPromptWithTools(systemPrompt: string, tools: Tool[]) {
  if (tools.length === 0) {
    return systemPrompt;
  }

  const toolLines = tools.map((tool) => {
    const parameters = tool.parameters
      .map((parameter) => `${parameter.name}:${parameter.type}${parameter.required ? ":required" : ""}`)
      .join(", ") || "none";

    return `- ${tool.id} (${tool.name}): ${tool.description}. Parameters: ${parameters}`;
  });

  return [
    systemPrompt,
    "",
    "Available tools:",
    ...toolLines,
    "",
    "When a tool is required, respond exactly as TOOL_CALL followed by compact JSON:",
    'TOOL_CALL {"toolId":"tool_id","arguments":{"name":"value"}}',
    "After a tool result is provided, answer the caller naturally.",
  ].join("\n");
}

function parseToolRequest(text: string): { toolId: string; arguments: Record<string, unknown> } | null {
  const match = text.match(/TOOL_CALL\s*(\{[\s\S]*\})/i);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "toolId" in parsed &&
      typeof parsed.toolId === "string"
    ) {
      const args = "arguments" in parsed && isRecord(parsed.arguments) ? parsed.arguments : {};

      return { toolId: parsed.toolId, arguments: args };
    }
  } catch {
    return null;
  }

  return null;
}

function toolResultMessage(result: ToolExecutionResult) {
  return `Tool result for ${result.toolName}: ${JSON.stringify({
    ok: result.ok,
    status: result.status,
    attempts: result.attempts,
    error: result.error,
    response: result.response.body,
  })}. Answer the caller using this result.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
