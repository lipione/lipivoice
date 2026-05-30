import { useEffect, useMemo, useState } from "react";
import { Phone, Play, Save } from "lucide-react";

import { getJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Agent, Call, CallEvent, PhoneNumber } from "@/domain/types";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "failed";

const defaultForm = {
  label: "Main line",
  number: "+15551201001",
  provider: "simulation" as PhoneNumber["provider"],
  status: "active" as PhoneNumber["status"],
  agentId: "none",
  inboundEnabled: true,
  outboundEnabled: false,
};

export function PhoneNumbersPage() {
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedNumberId, setSelectedNumberId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [testState, setTestState] = useState<SaveState>("idle");
  const [lastTestCallId, setLastTestCallId] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadPhoneNumbers() {
      setIsLoading(true);
      setError(null);

      try {
        const [nextPhoneNumbers, nextAgents] = await Promise.all([
          getJson<PhoneNumber[]>("/api/phone-numbers"),
          getJson<Agent[]>("/api/agents"),
        ]);
        if (!isCurrent) return;

        setPhoneNumbers(nextPhoneNumbers);
        setAgents(nextAgents);
        const firstNumber = nextPhoneNumbers[0] ?? null;
        setSelectedNumberId(firstNumber?.id ?? null);
        setForm(firstNumber ? formFromPhoneNumber(firstNumber) : defaultForm);
      } catch (loadError) {
        if (!isCurrent) return;

        setError(loadError instanceof Error ? loadError.message : "Unable to load phone numbers.");
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadPhoneNumbers();

    return () => {
      isCurrent = false;
    };
  }, []);

  const selectedNumber = useMemo(
    () => phoneNumbers.find((phoneNumber) => phoneNumber.id === selectedNumberId) ?? null,
    [phoneNumbers, selectedNumberId],
  );

  function selectNumber(phoneNumber: PhoneNumber) {
    setSelectedNumberId(phoneNumber.id);
    setForm(formFromPhoneNumber(phoneNumber));
    setSaveState("idle");
    setTestState("idle");
    setLastTestCallId(null);
  }

  function createNewNumber() {
    setSelectedNumberId(null);
    setForm({
      ...defaultForm,
      agentId: agents[0]?.id ?? "none",
    });
    setSaveState("idle");
    setTestState("idle");
    setLastTestCallId(null);
  }

  async function saveNumber() {
    const now = new Date().toISOString();
    const phoneNumber: PhoneNumber = {
      id: selectedNumberId ?? createPhoneNumberId(form.label || form.number),
      label: form.label.trim(),
      number: form.number.trim(),
      provider: form.provider,
      status: form.status,
      agentId: form.agentId === "none" ? null : form.agentId,
      inboundEnabled: form.inboundEnabled,
      outboundEnabled: form.outboundEnabled,
      createdAt: selectedNumber?.createdAt ?? now,
      updatedAt: now,
    };

    setSaveState("saving");
    try {
      const savedNumber = await postJson<PhoneNumber>("/api/phone-numbers", phoneNumber);
      setPhoneNumbers((currentNumbers) => {
        const existing = currentNumbers.some((currentNumber) => currentNumber.id === savedNumber.id);
        return existing
          ? currentNumbers.map((currentNumber) =>
              currentNumber.id === savedNumber.id ? savedNumber : currentNumber,
            )
          : [...currentNumbers, savedNumber];
      });
      setSelectedNumberId(savedNumber.id);
      setForm(formFromPhoneNumber(savedNumber));
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }

  async function startInboundTestCall() {
    if (!selectedNumber) return;

    setTestState("saving");
    try {
      const result = await postJson<{ call: Call; events: CallEvent[] }>("/api/calls/phone/start", {
        phoneNumberId: selectedNumber.id,
        direction: "inbound",
      });
      setLastTestCallId(result.call.id);
      setTestState("saved");
    } catch {
      setTestState("failed");
    }
  }

  if (isLoading) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Phone Numbers">
        <Card>
          <CardHeader>
            <CardTitle>Phone Numbers</CardTitle>
            <CardDescription>Loading local telephony routes.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Loading phone numbers...</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Phone Numbers">
        <Card>
          <CardHeader>
            <CardTitle>Phone Numbers</CardTitle>
            <CardDescription>Unable to load telephony routes.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="danger">{error}</Badge>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Phone Numbers">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Number routing</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage simulated and bring-your-own numbers, then route inbound calls to an agent.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{phoneNumbers.length} numbers</Badge>
          <Button type="button" size="sm" variant="outline" onClick={createNewNumber}>
            <Phone aria-hidden="true" />
            New number
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Numbers</CardTitle>
            <CardDescription>Workspace phone routes</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {phoneNumbers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No numbers configured.</p>
            ) : (
              phoneNumbers.map((phoneNumber) => {
                const isSelected = phoneNumber.id === selectedNumberId;
                const agentName = agentLabel(agents, phoneNumber.agentId);

                return (
                  <Button
                    key={phoneNumber.id}
                    type="button"
                    variant={isSelected ? "secondary" : "ghost"}
                    className={cn("h-auto justify-start px-3 py-2 text-left", isSelected && "bg-muted")}
                    onClick={() => selectNumber(phoneNumber)}
                  >
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate font-medium">{phoneNumber.label}</span>
                        <Badge variant={phoneNumber.status === "active" ? "success" : "warning"}>
                          {phoneNumber.status}
                        </Badge>
                      </span>
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {phoneNumber.number}
                      </span>
                      <span className="truncate text-xs font-normal text-muted-foreground">{agentName}</span>
                    </span>
                  </Button>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Route builder</CardTitle>
                <CardDescription>Persist number assignment and call capabilities.</CardDescription>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => void saveNumber()}
                disabled={saveState === "saving" || !form.label.trim() || !form.number.trim()}
              >
                <Save aria-hidden="true" />
                {saveState === "saving" ? "Saving..." : "Save number"}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="phone-label">Label</Label>
                  <Input
                    id="phone-label"
                    value={form.label}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({ ...current, label: event.target.value }));
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone-number">Phone number</Label>
                  <Input
                    id="phone-number"
                    value={form.number}
                    placeholder="+15551201001"
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({ ...current, number: event.target.value }));
                    }}
                  />
                </div>
              </div>

              <div className="grid gap-4 rounded-md border border-border p-3 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="phone-provider">Provider</Label>
                  <select
                    id="phone-provider"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.provider}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({
                        ...current,
                        provider: event.target.value as PhoneNumber["provider"],
                      }));
                    }}
                  >
                    <option value="simulation">Simulation</option>
                    <option value="byo_sip">BYO SIP</option>
                    <option value="twilio">Twilio</option>
                    <option value="telnyx">Telnyx</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone-status">Status</Label>
                  <select
                    id="phone-status"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.status}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({
                        ...current,
                        status: event.target.value as PhoneNumber["status"],
                      }));
                    }}
                  >
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone-agent">Route to agent</Label>
                  <select
                    id="phone-agent"
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.agentId}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({ ...current, agentId: event.target.value }));
                    }}
                  >
                    <option value="none">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 rounded-md border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={form.inboundEnabled}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({ ...current, inboundEnabled: event.target.checked }));
                    }}
                  />
                  Inbound calls
                </label>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={form.outboundEnabled}
                    onChange={(event) => {
                      setSaveState("idle");
                      setForm((current) => ({ ...current, outboundEnabled: event.target.checked }));
                    }}
                  />
                  Outbound calls
                </label>
              </div>

              {saveState === "saved" ? (
                <Badge variant="success">Number saved</Badge>
              ) : saveState === "failed" ? (
                <Badge variant="danger">Save failed</Badge>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Test route</CardTitle>
              <CardDescription>{selectedNumber ? selectedNumber.number : "Select a number"}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Button
                type="button"
                onClick={() => void startInboundTestCall()}
                disabled={!selectedNumber || testState === "saving" || !selectedNumber.inboundEnabled}
              >
                <Play aria-hidden="true" />
                {testState === "saving" ? "Starting..." : "Start inbound test call"}
              </Button>
              {testState === "saved" ? (
                <Badge variant="success">Test call started</Badge>
              ) : testState === "failed" ? (
                <Badge variant="danger">Test call failed</Badge>
              ) : null}
              {lastTestCallId ? (
                <p className="break-all text-xs text-muted-foreground">Call {lastTestCallId}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Creates a phone-channel call record using the selected number assignment.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function formFromPhoneNumber(phoneNumber: PhoneNumber) {
  return {
    label: phoneNumber.label,
    number: phoneNumber.number,
    provider: phoneNumber.provider,
    status: phoneNumber.status,
    agentId: phoneNumber.agentId ?? "none",
    inboundEnabled: phoneNumber.inboundEnabled,
    outboundEnabled: phoneNumber.outboundEnabled,
  };
}

function agentLabel(agents: Agent[], agentId: string | null) {
  if (!agentId) {
    return "Unassigned";
  }

  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function createPhoneNumberId(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `phone_${slug || Date.now()}`;
}
