import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Phone,
  PhoneOff,
  Play,
  Plus,
  RotateCw,
  Users,
} from "lucide-react";

import { getJson, patchJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Agent, Campaign, CampaignRun } from "@/domain/types";

type CampaignStatus = Campaign["status"];

const STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
};

interface NewCampaignForm {
  name: string;
  type: Campaign["type"];
  agentId: string;
  notes: string;
}

const DEFAULT_FORM: NewCampaignForm = {
  name: "",
  type: "renewal_reminder",
  agentId: "",
  notes: "",
};

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, CampaignRun[]>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<NewCampaignForm>(DEFAULT_FORM);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [renewalAgentId, setRenewalAgentId] = useState("");
  const [renewalDays, setRenewalDays] = useState(30);
  const [renewalScheduledAt, setRenewalScheduledAt] = useState("");
  const [isBuildingRenewal, setIsBuildingRenewal] = useState(false);

  async function loadCampaigns() {
    setIsLoading(true);
    setError(null);
    try {
      const [campaignList, agentList] = await Promise.all([
        getJson<Campaign[]>("/api/campaigns"),
        getJson<Agent[]>("/api/agents"),
      ]);
      setCampaigns(campaignList);
      setAgents(agentList);
      if (!renewalAgentId && agentList.length > 0) {
        setRenewalAgentId(agentList[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaigns.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadCampaigns();
  }, []);

  async function loadRuns(campaignId: string) {
    const data = await getJson<CampaignRun[]>(`/api/campaigns/${campaignId}/runs`);
    setRuns((prev) => ({ ...prev, [campaignId]: data }));
  }

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      void loadRuns(id);
    }
  }

  async function handleCreate() {
    if (!form.name || !form.agentId) return;
    const created = await postJson<Campaign>("/api/campaigns", form);
    setCampaigns((prev) => [created, ...prev]);
    setForm(DEFAULT_FORM);
    setIsCreating(false);
  }

  async function handleLaunch(campaignId: string) {
    setLaunchingId(campaignId);
    try {
      await postJson(`/api/campaigns/${campaignId}/launch`, {});
      await loadCampaigns();
    } finally {
      setLaunchingId(null);
    }
  }

  async function handlePause(campaignId: string) {
    await patchJson<Campaign>(`/api/campaigns/${campaignId}`, { status: "paused" });
    await loadCampaigns();
  }

  async function handleBuildRenewal() {
    if (!renewalAgentId) return;
    setIsBuildingRenewal(true);
    try {
      const campaign = await postJson<Campaign>("/api/campaigns/build-renewal", {
        agentId: renewalAgentId,
        withinDays: renewalDays,
        scheduledAt: renewalScheduledAt ? new Date(renewalScheduledAt).toISOString() : null,
      });
      setCampaigns((prev) => [campaign, ...prev]);
    } finally {
      setIsBuildingRenewal(false);
    }
  }

  const stats = useMemo(() => {
    const running = campaigns.filter((c) => c.status === "running").length;
    const draft = campaigns.filter((c) => c.status === "draft").length;
    const completed = campaigns.filter((c) => c.status === "completed").length;
    const totalDialed = campaigns.reduce((sum, c) => sum + c.dialedCount, 0);
    const totalAnswered = campaigns.reduce((sum, c) => sum + c.answeredCount, 0);
    return { running, draft, completed, totalDialed, totalAnswered };
  }, [campaigns]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Outbound campaigns</h2>
          <p className="mt-1 text-sm text-muted-foreground">Renewal reminders, claim follow-ups, and survey batches.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadCampaigns()}>
            <RotateCw className="mr-1.5 h-4 w-4" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setIsCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New Campaign
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Running" value={stats.running} icon={<Play className="h-4 w-4 text-amber-700" />} />
        <StatCard label="Draft" value={stats.draft} icon={<Loader2 className="h-4 w-4 text-muted-foreground" />} />
        <StatCard label="Completed" value={stats.completed} icon={<CheckCircle2 className="h-4 w-4 text-emerald-700" />} />
        <StatCard label="Dialed" value={stats.totalDialed} icon={<Phone className="h-4 w-4 text-primary" />} />
        <StatCard label="Answered" value={stats.totalAnswered} icon={<Users className="h-4 w-4 text-primary" />} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Renewal auto-calls</CardTitle>
          <CardDescription>Find policies due for renewal and let the dialer call them at the scheduled time.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_10rem_14rem_auto] md:items-end">
            <div className="grid gap-2">
              <Label htmlFor="renewal-agent">Agent</Label>
              <select
                id="renewal-agent"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={renewalAgentId}
                onChange={(e) => setRenewalAgentId(e.target.value)}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="renewal-days">Due within days</Label>
              <Input
                id="renewal-days"
                type="number"
                min={1}
                max={365}
                value={renewalDays}
                onChange={(e) => setRenewalDays(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="renewal-scheduled-at">Auto-call at</Label>
              <Input
                id="renewal-scheduled-at"
                type="datetime-local"
                value={renewalScheduledAt}
                onChange={(e) => setRenewalScheduledAt(e.target.value)}
              />
            </div>
            <Button size="sm" variant="outline" disabled={isBuildingRenewal} onClick={() => void handleBuildRenewal()}>
              {isBuildingRenewal ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
              {renewalScheduledAt ? "Schedule calls" : "Build batch"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isCreating && (
        <Card className="border-primary/25 bg-muted/35">
          <CardHeader className="pb-3">
            <CardTitle>New campaign</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Input
              placeholder="Campaign name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Campaign["type"] }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="renewal_reminder">Renewal Reminder</option>
                <option value="claim_followup">Claim Follow-up</option>
                <option value="survey">Survey</option>
                <option value="account_update">Account Update</option>
                <option value="custom">Custom</option>
              </select>
              <select
                value={form.agentId}
                onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <textarea
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleCreate()}>Create</Button>
              <Button size="sm" variant="outline" onClick={() => { setIsCreating(false); setForm(DEFAULT_FORM); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {campaigns.length === 0 && (
          <div className="rounded-md border border-dashed border-border bg-card px-4 py-12 text-center text-sm leading-6 text-muted-foreground">
            No campaigns yet. Create one above or build a renewal campaign.
          </div>
        )}
        {campaigns.map((campaign) => (
          <CampaignRow
            key={campaign.id}
            campaign={campaign}
            agents={agents}
            isExpanded={expandedId === campaign.id}
            runs={runs[campaign.id] ?? null}
            isLaunching={launchingId === campaign.id}
            onToggle={() => toggleExpand(campaign.id)}
            onLaunch={() => void handleLaunch(campaign.id)}
            onPause={() => void handlePause(campaign.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface CampaignRowProps {
  campaign: Campaign;
  agents: Agent[];
  isExpanded: boolean;
  runs: CampaignRun[] | null;
  isLaunching: boolean;
  onToggle: () => void;
  onLaunch: () => void;
  onPause: () => void;
}

function CampaignRow({ campaign, agents, isExpanded, runs, isLaunching, onToggle, onLaunch, onPause }: CampaignRowProps) {
  const agent = agents.find((a) => a.id === campaign.agentId);
  const progress = campaign.totalContacts > 0
    ? Math.round((campaign.dialedCount / campaign.totalContacts) * 100)
    : 0;

  return (
    <Card>
      <div
        className="flex cursor-pointer items-center gap-4 p-4"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{campaign.name}</span>
            <Badge variant={statusBadgeVariant(campaign.status)}>{STATUS_LABELS[campaign.status]}</Badge>
            <Badge variant="outline" className="text-xs capitalize">{campaign.type.replace(/_/g, " ")}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{agent?.name ?? campaign.agentId}</span>
            <span>{campaign.totalContacts} contacts</span>
            <span>{campaign.dialedCount} dialed</span>
            <span>{campaign.answeredCount} answered</span>
            {campaign.scheduledAt && <span>Scheduled: {new Date(campaign.scheduledAt).toLocaleDateString()}</span>}
          </div>
          {campaign.totalContacts > 0 && (
            <div className="mt-2 h-1.5 w-48 max-w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {(campaign.status === "draft" || campaign.status === "scheduled") && (
            <Button size="sm" onClick={onLaunch} disabled={isLaunching}>
              {isLaunching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
              Launch
            </Button>
          )}
          {campaign.status === "running" && (
            <Button size="sm" variant="outline" onClick={onPause}>
              <PhoneOff className="mr-1 h-3.5 w-3.5" /> Pause
            </Button>
          )}
          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {runs === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Contact</th>
                    <th className="pb-2 text-left font-medium">Status</th>
                    <th className="pb-2 text-left font-medium">Attempts</th>
                    <th className="pb-2 text-left font-medium">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const contact = campaign.contacts.find((c) => c.customerId === run.customerId);
                    return (
                      <tr key={run.id} className="border-b border-border/70">
                        <td className="py-1.5">{contact?.name ?? run.customerId} <span className="text-muted-foreground">{contact?.phoneNumber}</span></td>
                        <td className="py-1.5">
                          <Badge variant={runStatusBadgeVariant(run.status)}>{run.status}</Badge>
                        </td>
                        <td className="py-1.5">{run.attemptCount}</td>
                        <td className="py-1.5">{run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {campaign.notes && (
            <p className="mt-3 text-xs italic text-muted-foreground">{campaign.notes}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      {icon}
      <div>
        <p className="text-lg font-semibold leading-none">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function statusBadgeVariant(status: CampaignStatus): "outline" | "warning" | "success" | "danger" | "secondary" {
  if (status === "running" || status === "paused" || status === "scheduled") return "warning";
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  return "outline";
}

function runStatusBadgeVariant(status: CampaignRun["status"]): "outline" | "warning" | "success" | "danger" | "secondary" {
  if (status === "completed" || status === "connected") return "success";
  if (status === "failed") return "danger";
  if (status === "no_answer" || status === "dialing") return "warning";
  return "outline";
}
