import { useEffect, useMemo, useState } from "react";
import { KeyRound, Play, Plus, Wrench } from "lucide-react";

import { getJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Tool, ToolExecutionLog } from "@/domain/types";

type SaveState = "idle" | "saving" | "saved" | "failed";

const defaultToolForm = {
  name: "",
  description: "",
  method: "GET" as Tool["method"],
  url: "https://example.com",
  authMode: "none" as Tool["authMode"],
  headerName: "",
  headerValue: "",
  parameter: "",
  timeoutMs: 5000,
  retryCount: 0,
  responseSchema: "{}",
};

export function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [executionLogs, setExecutionLogs] = useState<ToolExecutionLog[]>([]);
  const [form, setForm] = useState(defaultToolForm);
  const [testArgs, setTestArgs] = useState("{\"orderId\":\"A123\"}");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [executeState, setExecuteState] = useState<SaveState>("idle");

  useEffect(() => {
    let isCurrent = true;

    async function loadTools() {
      setIsLoading(true);
      setError(null);

      try {
        const [nextTools, nextExecutionLogs] = await Promise.all([
          getJson<Tool[]>("/api/tools"),
          getJson<ToolExecutionLog[]>("/api/tools/executions").catch(() => []),
        ]);
        if (!isCurrent) return;
        setTools(nextTools);
        setExecutionLogs(nextExecutionLogs);
      } catch (loadError) {
        if (!isCurrent) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load tools.");
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    void loadTools();

    return () => {
      isCurrent = false;
    };
  }, []);

  const selectedTool = useMemo(() => tools[0] ?? null, [tools]);

  async function saveTool() {
    const now = new Date().toISOString();
    const headers = headersFromForm(form);
    const tool: Tool = {
      id: createToolId(form.name),
      name: form.name.trim(),
      description: form.description.trim(),
      method: form.method,
      url: form.url.trim(),
      authMode: form.authMode,
      headers,
      parameters: form.parameter.trim()
        ? [{ name: form.parameter.trim(), type: "string", required: true }]
        : [],
      timeoutMs: form.timeoutMs,
      retryCount: form.retryCount,
      responseSchema: form.responseSchema,
      createdAt: now,
      updatedAt: now,
    };

    setSaveState("saving");
    try {
      const savedTool = await postJson<Tool>("/api/tools", tool);
      setTools((currentTools) => [
        savedTool,
        ...currentTools.filter((currentTool) => currentTool.id !== savedTool.id),
      ]);
      setForm(defaultToolForm);
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }

  async function runSelectedTool() {
    if (!selectedTool) return;

    let parsedArgs: Record<string, unknown>;
    try {
      const parsed = JSON.parse(testArgs) as unknown;
      parsedArgs = isRecord(parsed) ? parsed : {};
    } catch {
      setExecuteState("failed");
      return;
    }

    setExecuteState("saving");
    try {
      const log = await postJson<ToolExecutionLog>("/api/tools/execute", {
        toolId: selectedTool.id,
        arguments: parsedArgs,
      });
      setExecutionLogs((currentLogs) => [log, ...currentLogs.filter((currentLog) => currentLog.id !== log.id)]);
      setExecuteState("saved");
    } catch {
      setExecuteState("failed");
    }
  }

  if (isLoading) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Tools">
        <Card>
          <CardHeader>
            <CardTitle>Tools</CardTitle>
            <CardDescription>Loading API request tools.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Loading tools...</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Tools">
        <Card>
          <CardHeader>
            <CardTitle>Tools</CardTitle>
            <CardDescription>Unable to load tool definitions.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="danger">{error}</Badge>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Tools">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Tool definitions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Define API request tools that agents can be allowed to call.
          </p>
        </div>
        <Badge variant="outline">{tools.length} configured</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader>
            <CardTitle>Configured tools</CardTitle>
            <CardDescription>Request shape, auth mode, and parameters</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {tools.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tools configured.</p>
            ) : (
              tools.map((tool) => (
                <div key={tool.id} className="grid gap-3 rounded-md border border-border p-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{tool.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
                      </div>
                    </div>
                    <Badge variant="secondary">{tool.method}</Badge>
                  </div>
                  <p className="break-all rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{tool.url}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{tool.authMode}</Badge>
                    <Badge variant="outline">{tool.timeoutMs}ms</Badge>
                    <Badge variant="outline">{tool.retryCount} retries</Badge>
                  </div>
                  {tool.parameters.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {tool.parameters.map((parameter) => (
                        <Badge key={parameter.name} variant="success">
                          {parameter.name}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>New API tool</CardTitle>
              <CardDescription>Start with one required string parameter.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="tool-name">Name</Label>
                <Input
                  id="tool-name"
                  value={form.name}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => ({ ...current, name: event.target.value }));
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tool-description">Description</Label>
                <Textarea
                  id="tool-description"
                  value={form.description}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => ({ ...current, description: event.target.value }));
                  }}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <div className="grid gap-2">
                  <Label htmlFor="tool-method">Method</Label>
                  <select
                    id="tool-method"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.method}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, method: event.target.value as Tool["method"] }))
                    }
                  >
                    <option value="GET">GET request</option>
                    <option value="POST">POST request</option>
                    <option value="PUT">PUT request</option>
                    <option value="PATCH">PATCH request</option>
                    <option value="DELETE">DELETE request</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tool-url">URL</Label>
                  <Input
                    id="tool-url"
                    value={form.url}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({ ...current, url: event.target.value }));
                    }}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tool-parameter">Parameter</Label>
                <Input
                  id="tool-parameter"
                  value={form.parameter}
                  placeholder="orderId"
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => ({ ...current, parameter: event.target.value }));
                  }}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="tool-auth">Auth</Label>
                  <select
                    id="tool-auth"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.authMode}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, authMode: event.target.value as Tool["authMode"] }))
                    }
                  >
                    <option value="none">none</option>
                    <option value="bearer">bearer</option>
                    <option value="header">header</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tool-timeout">Timeout</Label>
                  <Input
                    id="tool-timeout"
                    type="number"
                    min={500}
                    max={60000}
                    value={form.timeoutMs}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, timeoutMs: Number(event.target.value) }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tool-retries">Retries</Label>
                  <Input
                    id="tool-retries"
                    type="number"
                    min={0}
                    max={3}
                    value={form.retryCount}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, retryCount: Number(event.target.value) }))
                    }
                  />
                </div>
              </div>
              {form.authMode !== "none" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="tool-header-name">Header name</Label>
                    <Input
                      id="tool-header-name"
                      value={form.authMode === "bearer" ? "authorization" : form.headerName}
                      disabled={form.authMode === "bearer"}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, headerName: event.target.value }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="tool-header-value">Header value</Label>
                    <Input
                      id="tool-header-value"
                      value={form.headerValue}
                      type="password"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, headerValue: event.target.value }))
                      }
                    />
                  </div>
                </div>
              ) : null}
              <Button
                type="button"
                disabled={saveState === "saving" || !form.name.trim() || !form.description.trim()}
                onClick={() => void saveTool()}
              >
                <Plus aria-hidden="true" />
                Save tool
              </Button>
              {saveState === "saved" ? (
                <Badge variant="success">Tool saved</Badge>
              ) : saveState === "failed" ? (
                <Badge variant="danger">Save failed</Badge>
              ) : null}
            </CardContent>
          </Card>

          {selectedTool ? (
            <>
              <Card>
                <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                  <div>
                    <CardTitle>Run tool</CardTitle>
                    <CardDescription>{selectedTool.name}</CardDescription>
                  </div>
                  <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </CardHeader>
                <CardContent className="grid gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="tool-test-arguments">Test arguments</Label>
                    <Textarea
                      id="tool-test-arguments"
                      className="min-h-24 font-mono"
                      value={testArgs}
                      onChange={(event) => {
                        setExecuteState("idle");
                        setTestArgs(event.target.value);
                      }}
                    />
                  </div>
                  <Button type="button" onClick={() => void runSelectedTool()} disabled={executeState === "saving"}>
                    <Play aria-hidden="true" />
                    {executeState === "saving" ? "Running..." : "Run tool"}
                  </Button>
                  {executeState === "saved" ? (
                    <Badge variant="success">Tool executed</Badge>
                  ) : executeState === "failed" ? (
                    <Badge variant="danger">Execution failed</Badge>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Execution logs</CardTitle>
                  <CardDescription>Recent request and response results</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {executionLogs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tool executions recorded.</p>
                  ) : (
                    executionLogs.slice(0, 5).map((log) => (
                      <div key={log.id} className="grid gap-2 rounded-md border border-border p-3 text-sm">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate font-medium">{log.toolName}</span>
                          <Badge variant={log.ok ? "success" : "danger"}>
                            {log.ok ? String(log.status) : log.error ?? "failed"}
                          </Badge>
                        </div>
                        <p className="break-all text-xs text-muted-foreground">{log.request?.url}</p>
                        <p className="break-words text-sm">{formatResponseBody(log.response?.body)}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function createToolId(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `tool_${slug || Date.now()}`;
}

function headersFromForm(form: typeof defaultToolForm): Tool["headers"] {
  if (form.authMode === "none" || !form.headerValue.trim()) {
    return [];
  }

  if (form.authMode === "bearer") {
    return [{ name: "authorization", value: `Bearer ${form.headerValue.trim()}`, secret: true }];
  }

  if (!form.headerName.trim()) {
    return [];
  }

  return [{ name: form.headerName.trim(), value: form.headerValue, secret: true }];
}

function formatResponseBody(body: string | undefined) {
  if (!body) {
    return "No response body";
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (isRecord(parsed)) {
      return Object.entries(parsed)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(", ");
    }
  } catch {
    return body;
  }

  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
