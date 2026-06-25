import { useEffect, useMemo, useState } from "react";
import { Activity, Megaphone, PhoneCall, TicketCheck } from "lucide-react";

import { getJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Agent, Appointment, Call, Campaign, Customer, ModelRuntime, Ticket, TransferRecord } from "@/domain/types";

type RuntimeSummary = {
  banner: string;
  badgeVariant: "success" | "warning" | "danger" | "outline";
  value: string;
  detail: string;
  badge: string;
};

interface DashboardData {
  runtimes: Pick<ModelRuntime, "id" | "kind" | "configuredState" | "healthStatus">[];
  calls: Call[];
  agents: Agent[];
  customers: Customer[];
  tickets: Ticket[];
  appointments: Appointment[];
  transfers: TransferRecord[];
  campaigns: Campaign[];
}

const emptyDashboardData: DashboardData = {
  runtimes: [],
  calls: [],
  agents: [],
  customers: [],
  tickets: [],
  appointments: [],
  transfers: [],
  campaigns: [],
};

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
  const [dashboardData, setDashboardData] = useState<DashboardData>(emptyDashboardData);
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    async function loadDashboard() {
      setIsLoading(true);
      setDashboardError(false);

      try {
        const [runtimes, calls, agents, customers, tickets, appointments, transfers, campaigns] = await Promise.all([
          getJson<Pick<ModelRuntime, "id" | "kind" | "configuredState" | "healthStatus">[]>("/api/model-runtimes"),
          getJson<Call[]>("/api/calls"),
          getJson<Agent[]>("/api/agents"),
          getJson<Customer[]>("/api/customers"),
          getJson<Ticket[]>("/api/tickets"),
          getJson<Appointment[]>("/api/appointments"),
          getJson<TransferRecord[]>("/api/transfers"),
          getJson<Campaign[]>("/api/campaigns"),
        ]);
        if (!isCurrent) return;

        setDashboardData({ runtimes, calls, agents, customers, tickets, appointments, transfers, campaigns });
      } catch {
        if (!isCurrent) return;

        setDashboardError(true);
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      isCurrent = false;
    };
  }, []);

  const runtimeSummary = useMemo(() => {
    if (isLoading) return loadingRuntimeSummary;
    if (dashboardError) return errorRuntimeSummary;

    return summarizeRuntimes(dashboardData.runtimes);
  }, [isLoading, dashboardError, dashboardData.runtimes]);

  const operatingSummary = useMemo(() => summarizeOperations(dashboardData), [dashboardData]);

  const metrics = [
    {
      label: "Runtime status",
      value: runtimeSummary.value,
      detail: runtimeSummary.detail,
      icon: Activity,
      badge: runtimeSummary.badge,
    },
    {
      label: "Active calls",
      value: operatingSummary.activeCalls.toString(),
      detail: `${operatingSummary.callsToday} calls today`,
      icon: PhoneCall,
      badge: operatingSummary.activeCalls > 0 ? "Live" : "Idle",
    },
    {
      label: "Open tickets",
      value: operatingSummary.openTickets.toString(),
      detail: `${operatingSummary.urgentTickets} urgent`,
      icon: TicketCheck,
      badge: operatingSummary.openTickets > 0 ? "Queue" : "Clear",
    },
    {
      label: "Renewal work",
      value: operatingSummary.runningCampaigns.toString(),
      detail: `${operatingSummary.pendingCallbacks} callbacks scheduled`,
      icon: Megaphone,
      badge: `${operatingSummary.totalCustomers} customers`,
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-normal">Today at the desk</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Live voice readiness, renewal work, and customer follow-up queues.
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

      <section className="w-full max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Queue mix</CardTitle>
            <CardDescription>Current work waiting for staff review.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <QueueRow label="Customers" value={operatingSummary.totalCustomers} />
            <QueueRow label="Tickets" value={operatingSummary.openTickets} />
            <QueueRow label="Callbacks" value={operatingSummary.pendingCallbacks} />
            <QueueRow label="Transfers" value={operatingSummary.queuedTransfers} />
            <QueueRow label="Agents" value={dashboardData.agents.length} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function QueueRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function summarizeOperations(data: DashboardData) {
  const today = new Date().toDateString();
  const activeCalls = data.calls.filter((call) => call.status === "connected").length;
  const callsToday = data.calls.filter((call) => new Date(call.startedAt).toDateString() === today).length;
  const openTickets = data.tickets.filter((ticket) => ticket.status === "open" || ticket.status === "in_progress").length;
  const urgentTickets = data.tickets.filter((ticket) => ticket.priority === "urgent" && ticket.status !== "closed").length;
  const pendingCallbacks = data.appointments.filter((appointment) => appointment.status === "scheduled").length;
  const queuedTransfers = data.transfers.filter((transfer) => transfer.status === "queued").length;
  const runningCampaigns = data.campaigns.filter((campaign) => campaign.status === "running").length;

  return {
    activeCalls,
    callsToday,
    openTickets,
    urgentTickets,
    pendingCallbacks,
    queuedTransfers,
    runningCampaigns,
    totalCustomers: data.customers.length,
  };
}

function summarizeRuntimes(
  runtimes: Pick<ModelRuntime, "id" | "kind" | "configuredState" | "healthStatus">[],
): RuntimeSummary {
  const speechRuntimes = runtimes.filter((runtime) => runtime.kind === "stt" || runtime.kind === "tts");
  const configuredSpeechRuntimes = speechRuntimes.filter(
    (runtime) =>
      runtime.configuredState === "configured" &&
      runtime.healthStatus !== "failed" &&
      runtime.healthStatus !== "unavailable" &&
      runtime.healthStatus !== "missing_model",
  );
  const hasConfiguredStt = configuredSpeechRuntimes.some((runtime) => runtime.kind === "stt");
  const hasConfiguredTts = configuredSpeechRuntimes.some((runtime) => runtime.kind === "tts");

  if (hasConfiguredStt && hasConfiguredTts) {
    return {
      banner: "Runtime ready",
      badgeVariant: "success",
      value: "Ready",
      detail: "Speech runtimes configured",
      badge: "Healthy",
    };
  }

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
