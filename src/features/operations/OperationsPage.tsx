import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarClock, GitBranch, Headphones, Inbox, RefreshCw, ShieldCheck, TicketCheck, UserRound } from "lucide-react";

import { getJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Appointment, Customer, Policy, Ticket, TransferRecord } from "@/domain/types";

interface OperationsState {
  customers: Customer[];
  tickets: Ticket[];
  appointments: Appointment[];
  transfers: TransferRecord[];
  policies: Policy[];
}

const emptyOperations: OperationsState = {
  customers: [],
  tickets: [],
  appointments: [],
  transfers: [],
  policies: [],
};

interface CmsSyncConfig {
  baseUrl: string;
  authMode: "none" | "bearer" | "api_key" | "basic";
  authValue: string;
  customerEndpoint: string;
  policyEndpoint: string;
}

const DEFAULT_CMS: CmsSyncConfig = {
  baseUrl: "",
  authMode: "none",
  authValue: "",
  customerEndpoint: "/customers",
  policyEndpoint: "/policies",
};

export function OperationsPage() {
  const [operations, setOperations] = useState<OperationsState>(emptyOperations);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cmsConfig, setCmsConfig] = useState<CmsSyncConfig>(DEFAULT_CMS);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [showCmsForm, setShowCmsForm] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadOperations() {
      setIsLoading(true);
      setError(null);

      try {
        const [customers, tickets, appointments, transfers, policies] = await Promise.all([
          getJson<Customer[]>("/api/customers"),
          getJson<Ticket[]>("/api/tickets"),
          getJson<Appointment[]>("/api/appointments"),
          getJson<TransferRecord[]>("/api/transfers"),
          getJson<Policy[]>("/api/policies"),
        ]);
        if (!isCurrent) return;

        setOperations({ customers, tickets, appointments, transfers, policies });
      } catch (loadError) {
        if (!isCurrent) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load operations.");
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    void loadOperations();

    return () => {
      isCurrent = false;
    };
  }, []);

  async function handleCmsSync() {
    if (!cmsConfig.baseUrl) return;
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result = await postJson<{
        customers: { created: number; updated: number; errors: number };
        policies: { created: number; updated: number; errors: number };
        syncedAt: string;
      }>("/api/cms/sync", cmsConfig);
      setSyncResult(
        `Sync complete: ${result.customers.created} customers created, ${result.customers.updated} updated. ${result.policies.created} policies created, ${result.policies.updated} updated.`
      );
      const [customers, policies] = await Promise.all([
        getJson<Customer[]>("/api/customers"),
        getJson<Policy[]>("/api/policies"),
      ]);
      setOperations((prev) => ({ ...prev, customers, policies }));
    } catch (e) {
      setSyncResult(`Sync failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsSyncing(false);
    }
  }

  const openTickets = useMemo(
    () => operations.tickets.filter((ticket) => ticket.status === "open" || ticket.status === "in_progress").length,
    [operations.tickets],
  );
  const scheduledAppointments = useMemo(
    () => operations.appointments.filter((appointment) => appointment.status === "scheduled").length,
    [operations.appointments],
  );
  const queuedTransfers = useMemo(
    () => operations.transfers.filter((transfer) => transfer.status === "queued").length,
    [operations.transfers],
  );
  const selectedCustomerPolicies = useMemo(
    () => selectedCustomerId
      ? operations.policies.filter((p) => p.customerId === selectedCustomerId)
      : [],
    [selectedCustomerId, operations.policies]
  );

  if (isLoading) {
    return (
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-4" aria-label="Operations">
        <Card>
          <CardHeader>
            <CardTitle>Operations</CardTitle>
            <CardDescription>Loading customer records and call outcomes.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Loading operations...</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-4" aria-label="Operations">
        <Card>
          <CardHeader>
            <CardTitle>Operations</CardTitle>
            <CardDescription>Unable to load internal records.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="danger">{error}</Badge>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto flex h-[calc(100vh-8rem)] min-h-[34rem] w-full max-w-7xl flex-col gap-4 overflow-hidden" aria-label="Operations">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Customer operations queue</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Caller profiles, policies, tickets, callbacks, and handoffs from live calls.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{operations.customers.length} customers</Badge>
          <Badge variant="outline">{operations.policies.length} policies</Badge>
          <Badge variant={openTickets > 0 ? "warning" : "outline"}>{openTickets} open tickets</Badge>
          <Badge variant={scheduledAppointments > 0 ? "success" : "outline"}>{scheduledAppointments} callbacks</Badge>
          <Badge variant={queuedTransfers > 0 ? "secondary" : "outline"}>{queuedTransfers} transfers</Badge>
          <Button size="sm" variant="outline" onClick={() => setShowCmsForm(!showCmsForm)}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> CMS Sync
          </Button>
        </div>
      </div>

      {showCmsForm && (
        <Card className="border-primary/25 bg-muted/35">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> CMS Sync
            </CardTitle>
            <CardDescription>Import customers and policies from your external CMS</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[minmax(14rem,1fr)_10rem_minmax(12rem,0.8fr)_auto] md:items-end">
            <div className="grid gap-2">
              <Label htmlFor="cms-base-url">CMS base URL</Label>
              <Input
                id="cms-base-url"
                placeholder="https://cms.example.com"
                value={cmsConfig.baseUrl}
                onChange={(e) => setCmsConfig((c) => ({ ...c, baseUrl: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cms-auth-mode">Auth</Label>
              <select
                id="cms-auth-mode"
                value={cmsConfig.authMode}
                onChange={(e) => setCmsConfig((c) => ({ ...c, authMode: e.target.value as CmsSyncConfig["authMode"] }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="none">No auth</option>
                <option value="bearer">Bearer token</option>
                <option value="api_key">API key</option>
                <option value="basic">Basic auth</option>
              </select>
            </div>
            {cmsConfig.authMode !== "none" && (
              <div className="grid gap-2">
                <Label htmlFor="cms-auth-value">Secret</Label>
                <Input
                  id="cms-auth-value"
                  placeholder="Auth value"
                  value={cmsConfig.authValue}
                  onChange={(e) => setCmsConfig((c) => ({ ...c, authValue: e.target.value }))}
                />
              </div>
            )}
            <Button size="sm" onClick={() => void handleCmsSync()} disabled={isSyncing || !cmsConfig.baseUrl}>
              {isSyncing ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Sync Now
            </Button>
          </CardContent>
          {syncResult && (
            <div className={`mx-4 mb-4 rounded-md border p-2 text-xs font-medium ${syncResult.startsWith("Sync failed") ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
              {syncResult}
            </div>
          )}
        </Card>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.4fr)]">
        <RecordPanel
          title="Customers"
          description="Known callers and leads"
          emptyText="No customers yet. Start a call or sync from CMS."
          icon={UserRound}
          count={operations.customers.length}
        >
          {operations.customers.map((customer) => {
            const policyCount = operations.policies.filter((p) => p.customerId === customer.id).length;
            return (
              <div
                key={customer.id}
                className={`cursor-pointer rounded-md border p-3 transition-colors ${selectedCustomerId === customer.id ? "border-primary/35 bg-muted" : "border-border bg-background hover:bg-muted/50"}`}
                onClick={() => setSelectedCustomerId(selectedCustomerId === customer.id ? null : customer.id)}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{customer.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatPhone(customer.phoneNumber)}</p>
                  </div>
                  <div className="flex gap-1">
                    {policyCount > 0 && <Badge variant="secondary">{policyCount} pol</Badge>}
                    <Badge variant={customer.source === "voice_call" ? "success" : "outline"}>{customer.source}</Badge>
                  </div>
                </div>
                {selectedCustomerId === customer.id && selectedCustomerPolicies.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {selectedCustomerPolicies.map((policy) => (
                      <div key={policy.id} className="rounded-md border border-border bg-card p-2 text-xs">
                        <div className="flex justify-between">
                          <span className="font-medium">{policy.policyNumber}</span>
                          <Badge variant={policy.status === "active" ? "success" : policy.status === "expired" ? "danger" : "outline"}>
                            {policy.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {policy.type} · NPR {policy.premium.toLocaleString()} · Ends {policy.endDate}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 grid gap-0.5 text-xs text-muted-foreground">
                  <span>Language: {customer.preferredLanguage}</span>
                  <span>Updated: {formatDate(customer.updatedAt)}</span>
                </div>
              </div>
            );
          })}
        </RecordPanel>

        <div className="grid min-h-0 gap-4 xl:grid-cols-3">
          <RecordPanel
            title="Tickets"
            description="Issues and escalations"
            emptyText="No tickets yet."
            icon={TicketCheck}
            count={operations.tickets.length}
          >
            {operations.tickets.map((ticket) => (
              <div key={ticket.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-semibold">{ticket.subject}</p>
                  <Badge variant={ticket.priority === "urgent" ? "danger" : ticket.priority === "high" ? "warning" : "outline"}>
                    {ticket.priority}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{ticket.description || "No description"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">{ticket.status}</Badge>
                  <Badge variant="outline">{ticket.type}</Badge>
                </div>
              </div>
            ))}
          </RecordPanel>

          <RecordPanel
            title="Callbacks"
            description="Scheduled follow-ups"
            emptyText="No callbacks yet."
            icon={CalendarClock}
            count={operations.appointments.length}
          >
            {operations.appointments.map((appointment) => (
              <div key={appointment.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{appointment.callerName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{formatPhone(appointment.phoneNumber)}</p>
                  </div>
                  <Badge variant={appointment.status === "scheduled" ? "success" : "outline"}>{appointment.status}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{appointment.preferredTime || "No time requested"}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{appointment.reason || "No reason"}</p>
              </div>
            ))}
          </RecordPanel>

          <RecordPanel
            title="Transfers"
            description="Queued handoffs"
            emptyText="No transfer requests yet."
            icon={GitBranch}
            count={operations.transfers.length}
          >
            {operations.transfers.map((transfer) => (
              <div key={transfer.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-semibold">{transfer.department}</p>
                  <Badge variant={transfer.status === "queued" ? "secondary" : "outline"}>{transfer.status}</Badge>
                </div>
                <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{transfer.reason || "No reason"}</p>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
                  {transfer.warmTransferAvailable ? "Warm transfer available" : "Callback handoff"}
                </div>
              </div>
            ))}
          </RecordPanel>
        </div>
      </div>
    </section>
  );
}

interface RecordPanelProps {
  title: string;
  description: string;
  emptyText: string;
  icon: typeof Inbox;
  count: number;
  children: ReactNode;
}

function RecordPanel({ title, description, emptyText, icon: Icon, count, children }: RecordPanelProps) {
  return (
    <Card className="flex min-h-0 flex-col overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">{title}</CardTitle>
          <CardDescription className="truncate">{description}</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{count}</Badge>
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto">
        {count === 0 ? (
          <div className="grid min-h-36 place-items-center rounded-md border border-dashed border-border bg-muted/40 px-4 text-center">
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          </div>
        ) : (
          <div className="grid gap-3">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function formatPhone(value: string) {
  if (value.length === 10) {
    return `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6)}`;
  }
  if (value.length === 13 && value.startsWith("977")) {
    return `+977 ${value.slice(3, 6)} ${value.slice(6, 9)} ${value.slice(9)}`;
  }
  return value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
