import { useEffect, useState } from "react";
import { Activity, Bot, Database, ListChecks, Phone, ReceiptText, Wrench } from "lucide-react";

import { getJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UsageSummary } from "@/domain/types";

const emptyUsage: UsageSummary = {
  agents: 0,
  phoneNumbers: 0,
  callsTotal: 0,
  activeCalls: 0,
  callMinutes: 0,
  estimatedCostUsd: 0,
  toolExecutions: 0,
  knowledgeBases: 0,
  knowledgeDocuments: 0,
};

export function UsagePage() {
  const [usage, setUsage] = useState<UsageSummary>(emptyUsage);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadUsage() {
      setIsLoading(true);
      setError(null);

      try {
        const nextUsage = await getJson<UsageSummary>("/api/usage");
        if (!isCurrent) return;

        setUsage(nextUsage);
      } catch (loadError) {
        if (!isCurrent) return;

        setError(loadError instanceof Error ? loadError.message : "Unable to load usage.");
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadUsage();

    return () => {
      isCurrent = false;
    };
  }, []);

  if (isLoading) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Usage">
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Loading local workspace metrics.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Loading usage...</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Usage">
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>Unable to load local workspace metrics.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="danger">{error}</Badge>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4" aria-label="Usage">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Usage overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Local operating metrics derived from calls, tools, numbers, agents, and documents.
          </p>
        </div>
        <Badge variant={usage.activeCalls > 0 ? "success" : "outline"}>
          {usage.activeCalls} active calls
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={ListChecks} label="Calls" value={String(usage.callsTotal)} detail={`${usage.activeCalls} active`} />
        <MetricCard icon={Activity} label="Minutes" value={`${usage.callMinutes} min`} detail="Connected duration" />
        <MetricCard icon={ReceiptText} label="Estimate" value={formatMoney(usage.estimatedCostUsd)} detail="Stored call cost" />
        <MetricCard icon={Wrench} label="Tool runs" value={String(usage.toolExecutions)} detail="Execution logs" />
        <MetricCard icon={Bot} label="Agents" value={String(usage.agents)} detail="Configured assistants" />
        <MetricCard icon={Phone} label="Numbers" value={String(usage.phoneNumbers)} detail="Phone routes" />
        <MetricCard
          icon={Database}
          label="Knowledge"
          value={String(usage.knowledgeBases)}
          detail={`${usage.knowledgeDocuments} documents`}
        />
      </div>
    </section>
  );
}

interface MetricCardProps {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}

function MetricCard({ icon: Icon, label, value, detail }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>{label}</CardTitle>
          <CardDescription>{detail}</CardDescription>
        </div>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-normal">{value}</p>
      </CardContent>
    </Card>
  );
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}
