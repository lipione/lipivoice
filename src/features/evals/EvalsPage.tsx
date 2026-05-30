import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Play, Save } from "lucide-react";

import { getJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Agent, EvalDefinition, EvalRun } from "@/domain/types";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "failed";

const defaultForm = {
  name: "Greeting eval",
  description: "Checks the agent greeting.",
  agentId: "",
  input: "Say hello.",
  expectedInclude: "LipiVoice",
  forbiddenInclude: "",
};

export function EvalsPage() {
  const [evals, setEvals] = useState<EvalDefinition[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [runState, setRunState] = useState<SaveState>("idle");

  useEffect(() => {
    let isCurrent = true;

    async function loadEvals() {
      setIsLoading(true);
      setError(null);

      try {
        const [nextEvals, nextAgents, nextRuns] = await Promise.all([
          getJson<EvalDefinition[]>("/api/evals"),
          getJson<Agent[]>("/api/agents"),
          getJson<EvalRun[]>("/api/evals/runs").catch(() => []),
        ]);
        if (!isCurrent) return;

        setEvals(nextEvals);
        setAgents(nextAgents);
        setRuns(nextRuns);
        const firstEval = nextEvals[0] ?? null;
        setSelectedEvalId(firstEval?.id ?? null);
        setForm(firstEval ? formFromEval(firstEval) : { ...defaultForm, agentId: nextAgents[0]?.id ?? "" });
      } catch (loadError) {
        if (!isCurrent) return;

        setError(loadError instanceof Error ? loadError.message : "Unable to load evals.");
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadEvals();

    return () => {
      isCurrent = false;
    };
  }, []);

  const selectedEval = useMemo(
    () => evals.find((evalDefinition) => evalDefinition.id === selectedEvalId) ?? null,
    [evals, selectedEvalId],
  );
  const latestRun = runs.find((run) => run.evalId === selectedEvalId) ?? null;

  function selectEval(evalDefinition: EvalDefinition) {
    setSelectedEvalId(evalDefinition.id);
    setForm(formFromEval(evalDefinition));
    setSaveState("idle");
    setRunState("idle");
  }

  function createNewEval() {
    setSelectedEvalId(null);
    setForm({ ...defaultForm, agentId: agents[0]?.id ?? "" });
    setSaveState("idle");
    setRunState("idle");
  }

  async function saveEval() {
    const now = new Date().toISOString();
    const evalDefinition: EvalDefinition = {
      id: selectedEvalId ?? createEvalId(form.name),
      name: form.name.trim(),
      description: form.description.trim(),
      agentId: form.agentId || agents[0]?.id || "",
      cases: [
        {
          id: selectedEval?.cases[0]?.id ?? "case_main",
          input: form.input.trim(),
          checks: checksFromForm(form),
        },
      ],
      createdAt: selectedEval?.createdAt ?? now,
      updatedAt: now,
    };

    setSaveState("saving");
    try {
      const savedEval = await postJson<EvalDefinition>("/api/evals", evalDefinition);
      setEvals((currentEvals) => {
        const existing = currentEvals.some((currentEval) => currentEval.id === savedEval.id);
        return existing
          ? currentEvals.map((currentEval) => (currentEval.id === savedEval.id ? savedEval : currentEval))
          : [...currentEvals, savedEval];
      });
      setSelectedEvalId(savedEval.id);
      setForm(formFromEval(savedEval));
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }

  async function runSelectedEval() {
    if (!selectedEval) return;

    setRunState("saving");
    try {
      const run = await postJson<EvalRun>(`/api/evals/${selectedEval.id}/run`, {});
      setRuns((currentRuns) => [run, ...currentRuns.filter((currentRun) => currentRun.id !== run.id)]);
      setRunState("saved");
    } catch {
      setRunState("failed");
    }
  }

  if (isLoading) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Evals">
        <Card>
          <CardHeader>
            <CardTitle>Evals</CardTitle>
            <CardDescription>Loading agent evaluation scenarios.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Loading evals...</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Evals">
        <Card>
          <CardHeader>
            <CardTitle>Evals</CardTitle>
            <CardDescription>Unable to load evaluation scenarios.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="danger">{error}</Badge>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Evals">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Agent evals</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Define deterministic checks and run them against local agent responses.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{evals.length} evals</Badge>
          <Button type="button" size="sm" variant="outline" onClick={createNewEval}>
            <FlaskConical aria-hidden="true" />
            New eval
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Definitions</CardTitle>
            <CardDescription>Reusable scenario checks</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {evals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No evals configured.</p>
            ) : (
              evals.map((evalDefinition) => {
                const isSelected = evalDefinition.id === selectedEvalId;
                const agentName = agents.find((agent) => agent.id === evalDefinition.agentId)?.name ?? evalDefinition.agentId;

                return (
                  <Button
                    key={evalDefinition.id}
                    type="button"
                    variant={isSelected ? "secondary" : "ghost"}
                    className={cn("h-auto justify-start px-3 py-2 text-left", isSelected && "bg-muted")}
                    onClick={() => selectEval(evalDefinition)}
                  >
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="truncate font-medium">{evalDefinition.name}</span>
                      <span className="truncate text-xs font-normal text-muted-foreground">{agentName}</span>
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {evalDefinition.cases.length} cases
                      </span>
                    </span>
                  </Button>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Eval builder</CardTitle>
                <CardDescription>One scenario with include/exclude checks.</CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => void saveEval()}
                disabled={saveState === "saving" || !form.name.trim() || !form.input.trim() || checksFromForm(form).length === 0}
              >
                <Save aria-hidden="true" />
                {saveState === "saving" ? "Saving..." : "Save eval"}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="eval-name">Name</Label>
                  <Input
                    id="eval-name"
                    value={form.name}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({ ...current, name: event.target.value }));
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="eval-agent">Agent</Label>
                  <select
                    id="eval-agent"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.agentId}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({ ...current, agentId: event.target.value }));
                    }}
                  >
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="eval-description">Description</Label>
                <Textarea
                  id="eval-description"
                  className="min-h-20"
                  value={form.description}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => ({ ...current, description: event.target.value }));
                  }}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="eval-input">User input</Label>
                <Textarea
                  id="eval-input"
                  className="min-h-24"
                  value={form.input}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => ({ ...current, input: event.target.value }));
                  }}
                />
              </div>

              <div className="grid gap-4 rounded-md border border-border p-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="eval-expected-include">Expected include</Label>
                  <Input
                    id="eval-expected-include"
                    value={form.expectedInclude}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({ ...current, expectedInclude: event.target.value }));
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="eval-forbidden-include">Forbidden include</Label>
                  <Input
                    id="eval-forbidden-include"
                    value={form.forbiddenInclude}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({ ...current, forbiddenInclude: event.target.value }));
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {checksFromForm(form).map((check) => (
                  <Badge key={`${check.type}-${check.value}`} variant={check.type === "includes" ? "success" : "warning"}>
                    {check.value}
                  </Badge>
                ))}
              </div>

              {saveState === "saved" ? (
                <Badge variant="success">Eval saved</Badge>
              ) : saveState === "failed" ? (
                <Badge variant="danger">Save failed</Badge>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Run</CardTitle>
                <CardDescription>{selectedEval ? selectedEval.name : "Select an eval"}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Button
                  type="button"
                  onClick={() => void runSelectedEval()}
                  disabled={!selectedEval || runState === "saving"}
                >
                  <Play aria-hidden="true" />
                  {runState === "saving" ? "Running..." : "Run eval"}
                </Button>
                {latestRun ? (
                  <div className="grid gap-3 rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={latestRun.status === "passed" ? "success" : "danger"}>{latestRun.status}</Badge>
                      <span className="font-semibold">{latestRun.score}%</span>
                    </div>
                    {latestRun.caseResults.map((result) => (
                      <div key={result.caseId} className="grid gap-1">
                        <p className="text-xs text-muted-foreground">{result.input}</p>
                        <p className="break-words">{result.response}</p>
                        {result.recommendation ? (
                          <p className="text-xs text-muted-foreground">{result.recommendation}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No run history for this eval.</p>
                )}
                {runState === "failed" ? <Badge variant="danger">Run failed</Badge> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Run history</CardTitle>
                <CardDescription>Newest first</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {runs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No eval runs recorded.</p>
                ) : (
                  runs.slice(0, 5).map((run) => (
                    <div key={run.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                      <span className="truncate">{run.evalId}</span>
                      <Badge variant={run.status === "passed" ? "success" : "danger"}>{run.score}%</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}

function formFromEval(evalDefinition: EvalDefinition) {
  const evalCase = evalDefinition.cases[0];
  const expectedInclude = evalCase?.checks.find((check) => check.type === "includes")?.value ?? "";
  const forbiddenInclude = evalCase?.checks.find((check) => check.type === "excludes")?.value ?? "";

  return {
    name: evalDefinition.name,
    description: evalDefinition.description,
    agentId: evalDefinition.agentId,
    input: evalCase?.input ?? defaultForm.input,
    expectedInclude,
    forbiddenInclude,
  };
}

function checksFromForm(form: typeof defaultForm): EvalDefinition["cases"][number]["checks"] {
  return [
    form.expectedInclude.trim() ? { type: "includes" as const, value: form.expectedInclude.trim() } : null,
    form.forbiddenInclude.trim() ? { type: "excludes" as const, value: form.forbiddenInclude.trim() } : null,
  ].filter((check): check is EvalDefinition["cases"][number]["checks"][number] => check !== null);
}

function createEvalId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `eval_${slug || Date.now()}`;
}
