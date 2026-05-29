import { useEffect, useMemo, useState } from "react";
import { Bot } from "lucide-react";

import { getJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Agent } from "@/domain/types";
import { RuntimeHealthPanel, type RuntimeHealthRecord } from "@/features/runtimes/RuntimeHealthPanel";
import { cn } from "@/lib/utils";

type EditableAgent = Pick<Agent, "id" | "name" | "greeting" | "systemPrompt" | "language">;

export function AgentsPage() {
  const [agents, setAgents] = useState<EditableAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeHealthRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadAgents() {
      setIsLoading(true);
      setError(null);

      try {
        const [nextAgents, nextRuntimes] = await Promise.all([
          getJson<EditableAgent[]>("/api/agents"),
          getJson<RuntimeHealthRecord[]>("/api/model-runtimes"),
        ]);

        if (!isCurrent) return;

        setAgents(nextAgents);
        setRuntimes(nextRuntimes);
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

  function updateSelectedAgent(field: keyof Omit<EditableAgent, "id">, value: string) {
    if (!selectedAgent) return;

    setAgents((currentAgents) =>
      currentAgents.map((agent) => (agent.id === selectedAgent.id ? { ...agent, [field]: value } : agent)),
    );
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
          <p className="mt-1 text-sm text-muted-foreground">Edit prompts and inspect local runtime readiness.</p>
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
                    onClick={() => setSelectedAgentId(agent.id)}
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
            <CardHeader>
              <CardTitle>Agent prompt</CardTitle>
              <CardDescription>Local edits are staged in the browser until save support lands.</CardDescription>
            </CardHeader>
            <CardContent>
              {selectedAgent ? (
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="agent-name">Name</Label>
                    <Input
                      id="agent-name"
                      value={selectedAgent.name ?? ""}
                      onChange={(event) => updateSelectedAgent("name", event.target.value)}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="agent-greeting">Greeting</Label>
                      <Input
                        id="agent-greeting"
                        value={selectedAgent.greeting ?? ""}
                        onChange={(event) => updateSelectedAgent("greeting", event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="agent-language">Language</Label>
                      <Input
                        id="agent-language"
                        value={selectedAgent.language ?? ""}
                        placeholder="en"
                        onChange={(event) => updateSelectedAgent("language", event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="agent-system-prompt">System prompt</Label>
                    <Textarea
                      id="agent-system-prompt"
                      className="min-h-48"
                      value={selectedAgent.systemPrompt ?? ""}
                      onChange={(event) => updateSelectedAgent("systemPrompt", event.target.value)}
                    />
                  </div>
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
