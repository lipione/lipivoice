import { useEffect, useMemo, useState } from "react";
import { Bot, Save } from "lucide-react";

import { getJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Agent, ModelRuntime, Tool, Voice } from "@/domain/types";
import { RuntimeHealthPanel } from "@/features/runtimes/RuntimeHealthPanel";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "failed";

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [runtimes, setRuntimes] = useState<ModelRuntime[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    let isCurrent = true;

    async function loadAgents() {
      setIsLoading(true);
      setError(null);

      try {
        const [nextAgents, nextRuntimes, nextTools, nextVoices] = await Promise.all([
          getJson<Agent[]>("/api/agents"),
          getJson<ModelRuntime[]>("/api/model-runtimes"),
          getJson<Tool[]>("/api/tools"),
          getJson<Voice[]>("/api/voices"),
        ]);

        if (!isCurrent) return;

        setAgents(nextAgents);
        setRuntimes(nextRuntimes);
        setTools(nextTools);
        setVoices(nextVoices);
        setSelectedAgentId((current) => current ?? nextAgents[0]?.id ?? null);
      } catch (loadError) {
        if (!isCurrent) return;

        setError(loadError instanceof Error ? loadError.message : "Unable to load agents.");
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadAgents();

    return () => {
      isCurrent = false;
    };
  }, []);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );
  const llmRuntimes = runtimes.filter((runtime) => runtime.kind === "llm");
  const sttRuntimes = runtimes.filter((runtime) => runtime.kind === "stt");

  function patchSelectedAgent(patch: Partial<Agent>) {
    if (!selectedAgent) return;

    setSaveState("idle");
    setAgents((currentAgents) =>
      currentAgents.map((agent) => (agent.id === selectedAgent.id ? { ...agent, ...patch } : agent)),
    );
  }

  function updateSelectedAgent(field: keyof Pick<Agent, "name" | "greeting" | "systemPrompt" | "language">, value: string) {
    patchSelectedAgent({ [field]: value });
  }

  function updateModelRuntime(runtimeId: string) {
    const runtime = runtimes.find((candidate) => candidate.id === runtimeId);
    patchSelectedAgent({
      modelRuntimeId: runtimeId,
      modelAssetId: runtime?.defaultModelId ?? selectedAgent?.modelAssetId ?? "",
    });
  }

  function toggleTool(toolId: string, checked: boolean) {
    if (!selectedAgent) return;

    const nextToolIds = checked
      ? Array.from(new Set([...selectedAgent.toolIds, toolId]))
      : selectedAgent.toolIds.filter((currentToolId) => currentToolId !== toolId);
    patchSelectedAgent({ toolIds: nextToolIds });
  }

  async function saveSelectedAgent() {
    if (!selectedAgent) return;

    setSaveState("saving");
    try {
      const savedAgent = await postJson<Agent>("/api/agents", {
        ...selectedAgent,
        updatedAt: new Date().toISOString(),
      });
      setAgents((currentAgents) =>
        currentAgents.map((agent) => (agent.id === savedAgent.id ? savedAgent : agent)),
      );
      setSelectedAgentId(savedAgent.id);
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }

  if (isLoading) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Agents">
        <Card>
          <CardHeader>
            <CardTitle>Agents</CardTitle>
            <CardDescription>Loading local agent configuration.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Loading agents...</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Agents">
        <Card>
          <CardHeader>
            <CardTitle>Agents</CardTitle>
            <CardDescription>Unable to load the agent workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="danger">{error}</Badge>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Agents">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Agent management</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure prompts, model runtimes, voices, recording, and tool access.
          </p>
        </div>
        <Badge variant="outline">{agents.length} configured</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Agents</CardTitle>
            <CardDescription>Workspace voice agents</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agents configured.</p>
            ) : (
              agents.map((agent) => {
                const isSelected = agent.id === selectedAgent?.id;

                return (
                  <Button
                    key={agent.id}
                    type="button"
                    variant={isSelected ? "secondary" : "ghost"}
                    className={cn("h-auto justify-start gap-3 px-3 py-2 text-left", isSelected && "bg-muted")}
                    onClick={() => {
                      setSelectedAgentId(agent.id);
                      setSaveState("idle");
                    }}
                  >
                    <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{agent.name || "Untitled agent"}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {agent.greeting || "No greeting"}
                      </span>
                    </span>
                  </Button>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Agent builder</CardTitle>
                <CardDescription>Persist assistant behavior and runtime wiring.</CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => void saveSelectedAgent()}
                disabled={!selectedAgent || saveState === "saving"}
              >
                <Save aria-hidden="true" />
                {saveState === "saving" ? "Saving..." : "Save agent"}
              </Button>
            </CardHeader>
            <CardContent>
              {selectedAgent ? (
                <div className="grid gap-5">
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="agent-name">Name</Label>
                      <Input
                        id="agent-name"
                        value={selectedAgent.name}
                        onChange={(event) => updateSelectedAgent("name", event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="agent-greeting">Greeting</Label>
                        <Input
                          id="agent-greeting"
                          value={selectedAgent.greeting}
                          onChange={(event) => updateSelectedAgent("greeting", event.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="agent-language">Language</Label>
                        <Input
                          id="agent-language"
                          value={selectedAgent.language}
                          placeholder="en"
                          onChange={(event) => updateSelectedAgent("language", event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="agent-system-prompt">System prompt</Label>
                      <Textarea
                        id="agent-system-prompt"
                        className="min-h-44"
                        value={selectedAgent.systemPrompt}
                        onChange={(event) => updateSelectedAgent("systemPrompt", event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 rounded-md border border-border p-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="agent-model-runtime">Model runtime</Label>
                      <select
                        id="agent-model-runtime"
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={selectedAgent.modelRuntimeId}
                        onChange={(event) => updateModelRuntime(event.target.value)}
                      >
                        {llmRuntimes.map((runtime) => (
                          <option key={runtime.id} value={runtime.id}>
                            {runtime.adapter} - {runtime.healthStatus}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="agent-transcriber-runtime">Transcriber</Label>
                      <select
                        id="agent-transcriber-runtime"
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={selectedAgent.transcriberRuntimeId}
                        onChange={(event) => patchSelectedAgent({ transcriberRuntimeId: event.target.value })}
                      >
                        {sttRuntimes.map((runtime) => (
                          <option key={runtime.id} value={runtime.id}>
                            {runtime.adapter} - {runtime.healthStatus}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="agent-voice">Voice</Label>
                      <select
                        id="agent-voice"
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={selectedAgent.voiceId}
                        onChange={(event) => patchSelectedAgent({ voiceId: event.target.value })}
                      >
                        {voices.map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name} - {voice.language}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="agent-interruption">Interruption</Label>
                      <select
                        id="agent-interruption"
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={selectedAgent.interruptionSensitivity}
                        onChange={(event) =>
                          patchSelectedAgent({
                            interruptionSensitivity: event.target.value as Agent["interruptionSensitivity"],
                          })
                        }
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-md border border-border p-3">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={selectedAgent.recordingEnabled}
                        onChange={(event) => patchSelectedAgent({ recordingEnabled: event.target.checked })}
                      />
                      Record calls
                    </label>
                    <div className="grid gap-2">
                      <p className="text-sm font-medium">Tools</p>
                      {tools.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No tools configured.</p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {tools.map((tool) => (
                            <label
                              key={tool.id}
                              className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                aria-label={tool.name}
                                className="mt-0.5 h-4 w-4 rounded border-input"
                                checked={selectedAgent.toolIds.includes(tool.id)}
                                onChange={(event) => toggleTool(tool.id, event.target.checked)}
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{tool.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {tool.method} {tool.url}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {saveState === "saved" ? (
                    <Badge variant="success">Agent saved</Badge>
                  ) : saveState === "failed" ? (
                    <Badge variant="danger">Save failed</Badge>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Select an agent to edit its prompt.</p>
              )}
            </CardContent>
          </Card>

          <RuntimeHealthPanel runtimes={runtimes} />
        </div>
      </div>
    </section>
  );
}
