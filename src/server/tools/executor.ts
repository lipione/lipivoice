import type { Tool } from "@/domain/types";

export interface ToolExecutionResult {
  toolId: string;
  toolName: string;
  ok: boolean;
  status: number;
  durationMs: number;
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
  const { url, remainingArgs } = interpolateUrl(tool.url, args);
  const headersToSend = Object.fromEntries(tool.headers.map((header) => [header.name, header.value]));
  const redactedHeaders = tool.headers.map((header) => ({
    name: header.name,
    value: header.secret ? "[redacted]" : header.value,
  }));
  const startedAt = performance.now();
  const init: RequestInit = {
    method: tool.method,
    headers: headersToSend,
  };

  if (tool.method === "GET" || tool.method === "DELETE") {
    const urlWithQuery = appendQuery(url, remainingArgs);
    const response = await fetchImpl(urlWithQuery, init);

    return formatResult(tool, urlWithQuery, redactedHeaders, response, startedAt);
  }

  init.headers = { "content-type": "application/json", ...headersToSend };
  init.body = JSON.stringify(remainingArgs);

  const response = await fetchImpl(url, init);

  return formatResult(tool, url, redactedHeaders, response, startedAt);
}

async function formatResult(
  tool: Tool,
  url: string,
  redactedHeaders: Array<{ name: string; value: string }>,
  response: Response,
  startedAt: number,
): Promise<ToolExecutionResult> {
  return {
    toolId: tool.id,
    toolName: tool.name,
    ok: response.ok,
    status: response.status,
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
