import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, ListChecks, MessageSquareText, PhoneCall, PhoneOff } from "lucide-react";

import { getJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { Agent, Call, CallEvent } from "@/domain/types";
import { cn } from "@/lib/utils";

type CallRecord = Call;

function formatDuration(seconds: number | null | undefined) {
  return `${seconds ?? 0}s`;
}

function formatMoney(value: number | null | undefined) {
  return `$${(value ?? 0).toFixed(2)}`;
}

function formatPayload(payload: Record<string, unknown> | undefined) {
  if (!payload) return "No event payload";

  const toolSummary = formatToolPayload(payload);
  if (toolSummary) return toolSummary;

  const toolName = payload.toolName;
  if (typeof toolName === "string") return toolName;

  const name = payload.name;
  if (typeof name === "string") return name;

  const code = payload.code;
  if (typeof code === "string") return code;

  const status = payload.status;
  if (typeof status === "string") return status;

  const text = payload.text;
  if (typeof text === "string") return text;

  return JSON.stringify(payload);
}

function formatToolPayload(payload: Record<string, unknown>) {
  const toolName = payload.toolName;
  if (typeof toolName !== "string") {
    return null;
  }

  const parts = [toolName];
  const ok = payload.ok;
  const status = payload.status;
  if (typeof ok === "boolean" || typeof status === "number") {
    if (ok === false && status === 0) {
      parts.push("failed");
    } else if (typeof status === "number") {
      parts.push(String(status));
    }
  }

  const attempts = payload.attempts;
  if (typeof attempts === "number") {
    parts.push(`${attempts} ${attempts === 1 ? "attempt" : "attempts"}`);
  }

  const error = payload.error;
  if (typeof error === "string" && error.length > 0) {
    parts.push(error);
  }

  return parts.join(" · ");
}

function toAgentOptions(agents: Agent[]): Array<Pick<Agent, "id" | "name">> {
  return agents
    .filter((agent) => typeof agent.id === "string" && typeof agent.name === "string")
    .map((agent) => ({ id: agent.id, name: agent.name }));
}

export function CallsPage() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [agents, setAgents] = useState<Pick<Agent, "id" | "name">[]>([]);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [events, setEvents] = useState<CallEvent[]>([]);
  const [isLoadingCalls, setIsLoadingCalls] = useState(true);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [callsError, setCallsError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [endState, setEndState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [startState, setStartState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const eventRequestIdRef = useRef(0);

  useEffect(() => {
    let isCurrent = true;

    async function loadCalls() {
      setIsLoadingCalls(true);
      setCallsError(null);

      try {
        const [nextCalls, nextAgents] = await Promise.all([
          getJson<CallRecord[]>("/api/calls"),
          getJson<Agent[]>("/api/agents").catch(() => []),
        ]);
        if (!isCurrent) return;

        const agentOptions = toAgentOptions(nextAgents);
        setCalls(nextCalls);
        setAgents(agentOptions);
        setSelectedAgentId((currentAgentId) => currentAgentId || agentOptions[0]?.id || "");
        if (nextCalls[0]) {
          void selectCall(nextCalls[0].id);
        }
      } catch (error) {
        if (!isCurrent) return;

        setCallsError(error instanceof Error ? error.message : "Unable to load calls.");
      } finally {
        if (isCurrent) {
          setIsLoadingCalls(false);
        }
      }
    }

    void loadCalls();

    return () => {
      isCurrent = false;
    };
  }, []);

  const selectedCall = useMemo(
    () => calls.find((call) => call.id === selectedCallId) ?? null,
    [calls, selectedCallId],
  );
  const transcriptEvents = events.filter((event) => event.type === "transcript");
  const debugEvents = events.filter((event) => event.type !== "transcript");

  async function startSimulatedCall() {
    if (!selectedAgentId) return;

    eventRequestIdRef.current += 1;
    setStartState("saving");
    setEventsError(null);
    setEvents([]);

    try {
      const result = await postJson<{ call: CallRecord; events: CallEvent[] }>("/api/calls/simulate", {
        agentId: selectedAgentId,
      });
      setCalls((currentCalls) => [
        result.call,
        ...currentCalls.filter((currentCall) => currentCall.id !== result.call.id),
      ]);
      setSelectedCallId(result.call.id);
      setEvents(result.events);
      setIsLoadingEvents(false);
      setEndState("idle");
      setStartState("saved");
    } catch {
      setStartState("failed");
    }
  }

  async function selectCall(callId: string) {
    const requestId = eventRequestIdRef.current + 1;
    eventRequestIdRef.current = requestId;
    setSelectedCallId(callId);
    setIsLoadingEvents(true);
    setEventsError(null);
    setEndState("idle");
    setEvents([]);

    try {
      const nextEvents = await getJson<CallEvent[]>(`/api/calls/${callId}/events`);
      if (eventRequestIdRef.current !== requestId) return;

      setEvents(nextEvents);
    } catch (error) {
      if (eventRequestIdRef.current !== requestId) return;

      setEventsError(error instanceof Error ? error.message : "Unable to load call events.");
    } finally {
      if (eventRequestIdRef.current === requestId) {
        setIsLoadingEvents(false);
      }
    }
  }

  async function endSelectedCall() {
    if (!selectedCall) return;

    setEndState("saving");
    try {
      const result = await postJson<{ call: CallRecord; events: CallEvent[] }>(
        `/api/calls/${selectedCall.id}/end`,
        {},
      );
      setCalls((currentCalls) =>
        currentCalls.map((call) => (call.id === result.call.id ? result.call : call)),
      );
      setEvents((currentEvents) => [
        ...currentEvents,
        ...result.events.filter((event) => !currentEvents.some((currentEvent) => currentEvent.id === event.id)),
      ]);
      setEndState("saved");
    } catch {
      setEndState("failed");
    }
  }

  if (isLoadingCalls) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Calls">
        <Card>
          <CardHeader>
            <CardTitle>Calls</CardTitle>
            <CardDescription>Loading local call activity.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Loading calls...</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (callsError) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Calls">
        <Card>
          <CardHeader>
            <CardTitle>Calls</CardTitle>
            <CardDescription>Unable to load call records.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="danger">{callsError}</Badge>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Calls">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Call activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">Review local web, phone, and simulated call records.</p>
        </div>
        <Badge variant="outline">{calls.length} recorded</Badge>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Simulation</CardTitle>
            <CardDescription>Start an inbound local test call</CardDescription>
          </div>
          <Badge variant="secondary">{agents.length} agents</Badge>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor="simulate-agent">Agent</Label>
            <select
              id="simulate-agent"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={selectedAgentId}
              onChange={(event) => {
                setStartState("idle");
                setSelectedAgentId(event.target.value);
              }}
            >
              {agents.length === 0 ? <option value="">No agents available</option> : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => void startSimulatedCall()}
              disabled={!selectedAgentId || startState === "saving"}
            >
              <PhoneCall aria-hidden="true" />
              {startState === "saving" ? "Starting..." : "Start simulated call"}
            </Button>
            {startState === "saved" ? (
              <Badge variant="success">Call started</Badge>
            ) : startState === "failed" ? (
              <Badge variant="danger">Start failed</Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card>
          <CardHeader>
            <CardTitle>Records</CardTitle>
            <CardDescription>Compact operational call list</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {calls.length === 0 ? (
              <p className="text-sm text-muted-foreground">No calls recorded.</p>
            ) : (
              calls.map((call) => {
                const isSelected = call.id === selectedCallId;

                return (
                  <Button
                    key={call.id}
                    type="button"
                    variant={isSelected ? "secondary" : "ghost"}
                    className={cn(
                      "grid h-auto grid-cols-[minmax(7rem,1fr)_5rem_5rem_4rem_minmax(7rem,1fr)] items-center gap-3 px-3 py-2 text-left",
                      isSelected && "bg-muted",
                    )}
                    onClick={() => void selectCall(call.id)}
                  >
                    <span className="truncate font-medium">{call.id}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{call.channel}</span>
                    <Badge variant={call.status === "failed" ? "danger" : "outline"}>{call.status}</Badge>
                    <span className="text-xs font-normal text-muted-foreground">
                      {formatDuration(call.durationSeconds)}
                    </span>
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {call.failureReason ?? "none"}
                    </span>
                  </Button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Call detail</CardTitle>
            <CardDescription>{selectedCall ? "Selected call" : "Select a call"}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!selectedCall ? (
              <p className="text-sm text-muted-foreground">Select a call to load events.</p>
            ) : (
              <>
                <div className="grid gap-2 rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{selectedCall.direction} {selectedCall.channel}</span>
                    <Badge variant={selectedCall.status === "failed" ? "danger" : "outline"}>
                      {selectedCall.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Duration {formatDuration(selectedCall.durationSeconds)}</span>
                    <span>
                      Estimate <span>{formatMoney(selectedCall.costEstimateUsd)}</span>
                    </span>
                    {selectedCall.phoneNumberId ? <span>Number {selectedCall.phoneNumberId}</span> : null}
                    <span>Started {selectedCall.startedAt}</span>
                    <span>Ended {selectedCall.endedAt ?? "open"}</span>
                  </div>
                  {!selectedCall.endedAt && selectedCall.status !== "failed" && selectedCall.status !== "disconnected" ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void endSelectedCall()}
                        disabled={endState === "saving"}
                      >
                        <PhoneOff aria-hidden="true" />
                        {endState === "saving" ? "Ending..." : "End call"}
                      </Button>
                      {endState === "saved" ? (
                        <Badge variant="success">Call ended</Badge>
                      ) : endState === "failed" ? (
                        <Badge variant="danger">End failed</Badge>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {isLoadingEvents ? (
                  <p className="text-sm text-muted-foreground">Loading events...</p>
                ) : eventsError ? (
                  <Badge variant="danger">{eventsError}</Badge>
                ) : events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events recorded.</p>
                ) : (
                  <>
                    <div className="grid gap-2">
                      <h3 className="text-sm font-semibold tracking-normal">Transcript</h3>
                      {transcriptEvents.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No transcript segments yet.</p>
                      ) : (
                        transcriptEvents.map((event) => (
                          <div key={event.id} className="rounded-md border border-border p-3 text-sm">
                            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                              <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>{event.actor}</span>
                            </div>
                            <p>{formatPayload(event.payload)}</p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="grid gap-2">
                      <h3 className="text-sm font-semibold tracking-normal">Event timeline</h3>
                      {debugEvents.map((event) => (
                        <div key={event.id} className="grid gap-1 border-l border-border pl-3 text-sm">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-2 font-medium">
                              <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                              <span className="truncate">{event.type}</span>
                            </span>
                            <Badge variant={event.severity === "error" ? "danger" : "outline"}>{event.actor}</Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{event.timestamp}</span>
                          </div>
                          <p className="break-words text-sm text-muted-foreground">{formatPayload(event.payload)}</p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
