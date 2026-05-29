import type { Tool } from "@/domain/types";

export interface ToolExecutionResult {
  toolId: string;
  toolName: string;
  ok: boolean;
  status: number;
  attempts: number;
  durationMs: number;
  error?: string;
  request: {
    method: Tool["method"];
    url: string;
    headers: Array<{ name: string; value: string }>;
  };
  response: {
    body: string;
  };
}

interface ExecuteToolOptions {
  fetchImpl?: typeof fetch;
}

export async function executeTool(
  tool: Tool,
  args: Record<string, unknown>,
  options: ExecuteToolOptions = {},
): Promise<ToolExecutionResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = buildRequest(tool, args);
  const startedAt = performance.now();
  const maxAttempts = tool.retryCount + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, request.url, request.init, tool.timeoutMs);

      if (attempt < maxAttempts && isTransientStatus(response.status)) {
        continue;
      }

      return formatResult(tool, request.url, request.redactedHeaders, response, startedAt, attempt);
    } catch (error) {
      if (attempt < maxAttempts) {
        continue;
      }

      return formatFailure(
        tool,
        request.url,
        request.redactedHeaders,
        errorMessage(error),
        startedAt,
        attempt,
      );
    }
  }

  return formatFailure(
    tool,
    request.url,
    request.redactedHeaders,
    "tool_failed",
    startedAt,
    maxAttempts,
  );
}

function buildRequest(tool: Tool, args: Record<string, unknown>) {
  const { url, remainingArgs } = interpolateUrl(tool.url, args);
  const headersToSend = Object.fromEntries(tool.headers.map((header) => [header.name, header.value]));
  const redactedHeaders = tool.headers.map((header) => ({
    name: header.name,
    value: header.secret ? "[redacted]" : header.value,
  }));
  const init: RequestInit = {
    method: tool.method,
    headers: headersToSend,
  };

  if (tool.method === "GET" || tool.method === "DELETE") {
    return {
      url: appendQuery(url, remainingArgs),
      init,
      redactedHeaders,
    };
  }

  return {
    url,
    init: {
      ...init,
      headers: { "content-type": "application/json", ...headersToSend },
      body: JSON.stringify(remainingArgs),
    },
    redactedHeaders,
  };
}

async function formatResult(
  tool: Tool,
  url: string,
  redactedHeaders: Array<{ name: string; value: string }>,
  response: Response,
  startedAt: number,
  attempts: number,
): Promise<ToolExecutionResult> {
  return {
    toolId: tool.id,
    toolName: tool.name,
    ok: response.ok,
    status: response.status,
    attempts,
    durationMs: Math.round(performance.now() - startedAt),
    request: {
      method: tool.method,
      url,
      headers: redactedHeaders,
    },
    response: {
      body: await response.text(),
    },
  };
}

function formatFailure(
  tool: Tool,
  url: string,
  redactedHeaders: Array<{ name: string; value: string }>,
  error: string,
  startedAt: number,
  attempts: number,
): ToolExecutionResult {
  return {
    toolId: tool.id,
    toolName: tool.name,
    ok: false,
    status: 0,
    attempts,
    durationMs: Math.round(performance.now() - startedAt),
    error,
    request: {
      method: tool.method,
      url,
      headers: redactedHeaders,
    },
    response: {
      body: error,
    },
  };
}

function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let didTimeout = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      reject(new ToolTimeoutError());
    }, timeoutMs);

    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
  });
  const request = fetchImpl(url, { ...init, signal: controller.signal });

  return Promise.race([request, timeout]).catch((error: unknown) => {
    if (didTimeout || isAbortError(error)) {
      throw new ToolTimeoutError();
    }

    throw error;
  }).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

class ToolTimeoutError extends Error {
  constructor() {
    super("tool_timeout");
    this.name = "ToolTimeoutError";
  }
}

function isTransientStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown) {
  if (error instanceof ToolTimeoutError) {
    return "tool_timeout";
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "tool_failed";
}

function interpolateUrl(url: string, args: Record<string, unknown>) {
  const usedArgs = new Set<string>();
  const interpolatedUrl = url.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    usedArgs.add(key);
    return encodeURIComponent(String(args[key] ?? ""));
  });
  const remainingArgs = Object.fromEntries(
    Object.entries(args).filter(([key]) => !usedArgs.has(key)),
  );

  return { url: interpolatedUrl, remainingArgs };
}

function appendQuery(url: string, args: Record<string, unknown>) {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) {
    return url;
  }

  const nextUrl = new URL(url);
  entries.forEach(([key, value]) => {
    nextUrl.searchParams.set(key, String(value));
  });

  return nextUrl.toString();
}
