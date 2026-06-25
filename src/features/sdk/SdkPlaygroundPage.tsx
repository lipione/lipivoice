import { useEffect, useMemo, useState } from "react";
import { Code2 } from "lucide-react";

import { getJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { Agent } from "@/domain/types";

interface SdkSettings {
  publicBaseUrl?: string;
}

export function SdkPlaygroundPage() {
  const [agents, setAgents] = useState<Pick<Agent, "id" | "name">[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadSdkContext() {
      try {
        const [nextAgents, settings] = await Promise.all([
          getJson<Pick<Agent, "id" | "name">[]>("/api/agents"),
          getJson<SdkSettings>("/api/settings"),
        ]);

        if (!isCurrent) {
          return;
        }

        setAgents(nextAgents);
        setSelectedAgentId((currentAgentId) => currentAgentId || nextAgents[0]?.id || "");
        setPublicBaseUrl(settings.publicBaseUrl || window.location.origin);
      } catch {
        if (isCurrent) {
          setError("sdk_context_load_failed");
        }
      }
    }

    void loadSdkContext();

    return () => {
      isCurrent = false;
    };
  }, []);

  const snippet = useMemo(
    () => createBrowserVoiceSnippet(publicBaseUrl || window.location.origin, selectedAgentId),
    [publicBaseUrl, selectedAgentId],
  );

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="SDK Playground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">SDK Playground</h2>
          <p className="mt-1 text-sm text-muted-foreground">Browser voice connection snippets for self-hosted sessions.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">JavaScript</Badge>
          <Badge variant="secondary">Realtime WebSocket</Badge>
        </div>
      </div>

      {error ? <Badge variant="danger">{error}</Badge> : null}

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Snippet inputs</CardTitle>
            <CardDescription>Agent and deployment URL</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="sdk-agent">Agent</Label>
              <select
                id="sdk-agent"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
              >
                {agents.length === 0 ? <option value="">No agents available</option> : null}
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-md border border-border bg-background p-3 text-sm">
              <p className="text-xs font-medium uppercase text-muted-foreground">Public base URL</p>
              <p className="mt-1 break-all">{publicBaseUrl || window.location.origin}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Browser voice session</CardTitle>
              <CardDescription>Creates a short-lived token, then opens the realtime socket.</CardDescription>
            </div>
            <Code2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <pre
              aria-label="Browser voice SDK snippet"
              className="max-h-[32rem] overflow-auto rounded-md border border-border bg-slate-950 p-4 text-xs leading-6 text-slate-100"
            >
              <code>{snippet}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function createBrowserVoiceSnippet(baseUrl: string, agentId: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const realtimeBaseUrl = normalizedBaseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

  return `const baseUrl = "${normalizedBaseUrl}";
const agentId = "${agentId}";
const adminToken = "LIPIVOICE_ADMIN_TOKEN";

const sessionResponse = await fetch("${normalizedBaseUrl}/api/realtime/session", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    Authorization: "Bearer " + adminToken,
  },
  body: JSON.stringify({ agentId: "${agentId}" }),
});

const { token, expiresAt } = await sessionResponse.json();
const socket = new WebSocket("${realtimeBaseUrl}/api/realtime?token=" + encodeURIComponent(token));

socket.addEventListener("message", (event) => {
  const lipiVoiceEvent = JSON.parse(event.data);
  console.log("LipiVoice event", lipiVoiceEvent, { expiresAt });
});`;
}
