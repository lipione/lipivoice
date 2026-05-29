import { Activity, Bot, ListChecks, Mic } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const metrics = [
  {
    label: "Runtime status",
    value: "Ready",
    detail: "Local services configured",
    icon: Activity,
    badge: "Healthy",
  },
  {
    label: "Active sessions",
    value: "0",
    detail: "No live browser calls",
    icon: Mic,
    badge: "Idle",
  },
  {
    label: "Calls today",
    value: "0",
    detail: "Phone route is simulated",
    icon: ListChecks,
    badge: "Local",
  },
  {
    label: "Configured agents",
    value: "1",
    detail: "Default voice agent",
    icon: Bot,
    badge: "Draft",
  },
];

export function OverviewPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-normal">Operational summary</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Local voice-agent runtime status and current activity.
            </p>
          </div>
          <Badge variant="success">Runtime ready</Badge>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Overview metrics">
        {metrics.map((metric) => {
          const Icon = metric.icon;

          return (
            <Card key={metric.label}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
                <div className="min-w-0">
                  <CardTitle className="truncate">{metric.label}</CardTitle>
                  <CardDescription className="truncate">{metric.detail}</CardDescription>
                </div>
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </CardHeader>
              <CardContent className="flex items-end justify-between gap-3">
                <div className="truncate text-2xl font-semibold leading-none">{metric.value}</div>
                <Badge variant="outline">{metric.badge}</Badge>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="py-2" aria-labelledby="current-runbook-title">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0">
            <h3 id="current-runbook-title" className="text-sm font-semibold tracking-normal">
              Current runbook
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Use the sidebar to configure agents, test web voice, review calls, and inspect local usage.
            </p>
          </div>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Inference</span>
              <span className="truncate font-medium">Local model</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Speech</span>
              <span className="truncate font-medium">Whisper / Piper</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
