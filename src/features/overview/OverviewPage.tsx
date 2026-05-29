import { useEffect, useMemo, useState } from "react";
import { Activity, Bot, ListChecks, Mic } from "lucide-react";

import { getJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ModelRuntime } from "@/domain/types";

type RuntimeSummary = {
  banner: string;
  badgeVariant: "success" | "warning" | "danger" | "outline";
  value: string;
  detail: string;
  badge: string;
};

const staticMetrics = [
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

const loadingRuntimeSummary: RuntimeSummary = {
  banner: "Runtime checking",
  badgeVariant: "outline",
  value: "Checking",
  detail: "Reading local runtime config",
  badge: "Loading",
};

const errorRuntimeSummary: RuntimeSummary = {
  banner: "Runtime unknown",
  badgeVariant: "danger",
  value: "Unknown",
  detail: "Unable to load runtime status",
  badge: "Error",
};

export function OverviewPage() {
  const [runtimes, setRuntimes] = useState<Pick<ModelRuntime, "kind" | "configuredState" | "healthStatus">[]>([]);
  const [isLoadingRuntimes, setIsLoadingRuntimes] = useState(true);
  const [runtimeError, setRuntimeError] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    async function loadRuntimes() {
      setIsLoadingRuntimes(true);
      setRuntimeError(false);

      try {
        const nextRuntimes =
          await getJson<Pick<ModelRuntime, "kind" | "configuredState" | "healthStatus">[]>("/api/model-runtimes");
        if (!isCurrent) return;

        setRuntimes(nextRuntimes);
      } catch {
        if (!isCurrent) return;

        setRuntimeError(true);
      } finally {
        if (isCurrent) {
          setIsLoadingRuntimes(false);
        }
      }
    }

    void loadRuntimes();

    return () => {
      isCurrent = false;
    };
  }, []);

  const runtimeSummary = useMemo(() => {
    if (isLoadingRuntimes) return loadingRuntimeSummary;
    if (runtimeError) return errorRuntimeSummary;

    return summarizeRuntimes(runtimes);
  }, [isLoadingRuntimes, runtimeError, runtimes]);

  const metrics = [
    {
      label: "Runtime status",
      value: runtimeSummary.value,
      detail: runtimeSummary.detail,
      icon: Activity,
      badge: runtimeSummary.badge,
    },
    ...staticMetrics,
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-normal">Operational summary</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Self-hosted voice-agent runtime status and current activity.
            </p>
          </div>
          <Badge variant={runtimeSummary.badgeVariant}>{runtimeSummary.banner}</Badge>
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
              Use the sidebar to configure agents, test web voice, review calls, and inspect usage.
            </p>
          </div>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Inference</span>
              <span className="truncate font-medium">Open model</span>
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

function summarizeRuntimes(
  runtimes: Pick<ModelRuntime, "kind" | "configuredState" | "healthStatus">[],
): RuntimeSummary {
  const speechRuntimes = runtimes.filter((runtime) => runtime.kind === "stt" || runtime.kind === "tts");

  if (
    speechRuntimes.length === 0 ||
    speechRuntimes.some((runtime) => runtime.configuredState !== "configured")
  ) {
    return {
      banner: "Runtime not configured",
      badgeVariant: "warning",
      value: "Not configured",
      detail: "Speech runtimes missing",
      badge: "Setup",
    };
  }

  if (speechRuntimes.some((runtime) => runtime.healthStatus === "failed" || runtime.healthStatus === "unavailable")) {
    return {
      banner: "Runtime unavailable",
      badgeVariant: "danger",
      value: "Unavailable",
      detail: "Local runtime check failed",
      badge: "Failed",
    };
  }

  if (speechRuntimes.some((runtime) => runtime.healthStatus === "missing_model")) {
    return {
      banner: "Runtime not configured",
      badgeVariant: "warning",
      value: "Not configured",
      detail: "Speech models missing",
      badge: "Setup",
    };
  }

  return {
    banner: "Runtime ready",
    badgeVariant: "success",
    value: "Ready",
    detail: "Speech runtimes configured",
    badge: "Healthy",
  };
}
