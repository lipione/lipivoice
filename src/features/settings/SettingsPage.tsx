import { useEffect, useState } from "react";
import type * as React from "react";
import { LockKeyhole, Save, ShieldCheck } from "lucide-react";

import { getJson, postJson } from "@/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceSettings } from "@/domain/types";

type SaveState = "idle" | "saving" | "saved" | "failed";

interface SettingsForm {
  workspaceName: string;
  publicBaseUrl: string;
  allowedOriginsText: string;
  allowPrivateToolUrls: boolean;
  redactToolSecrets: boolean;
  recordingRetentionDays: number;
  auditLogRetentionDays: number;
  realtimeSessionTtlSeconds: number;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    let isCurrent = true;

    async function loadSettings() {
      setIsLoading(true);
      setError(null);

      try {
        const nextSettings = await getJson<WorkspaceSettings>("/api/settings");
        if (!isCurrent) return;

        setSettings(nextSettings);
        setForm(formFromSettings(nextSettings));
      } catch (loadError) {
        if (!isCurrent) return;

        setError(loadError instanceof Error ? loadError.message : "Unable to load settings.");
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      isCurrent = false;
    };
  }, []);

  async function saveSettings() {
    if (!settings || !form) return;

    const nextSettings: WorkspaceSettings = {
      ...settings,
      workspaceName: form.workspaceName.trim(),
      publicBaseUrl: form.publicBaseUrl.trim(),
      allowedOrigins: parseOrigins(form.allowedOriginsText),
      allowPrivateToolUrls: form.allowPrivateToolUrls,
      redactToolSecrets: form.redactToolSecrets,
      recordingRetentionDays: form.recordingRetentionDays,
      auditLogRetentionDays: form.auditLogRetentionDays,
      realtimeSessionTtlSeconds: form.realtimeSessionTtlSeconds,
      updatedAt: new Date().toISOString(),
    };

    setSaveState("saving");
    try {
      const saved = await postJson<WorkspaceSettings>("/api/settings", nextSettings);
      setSettings(saved);
      setForm(formFromSettings(saved));
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }

  if (isLoading) {
    return (
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-4" aria-label="Settings">
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Loading workspace configuration.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Loading settings...</p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (error || !form) {
    return (
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-4" aria-label="Settings">
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Unable to load workspace configuration.</CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="danger">{error ?? "settings_unavailable"}</Badge>
          </CardContent>
        </Card>
      </section>
    );
  }

  const canSave = form.workspaceName.trim() !== "" && form.recordingRetentionDays > 0 && form.auditLogRetentionDays > 0;

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4" aria-label="Settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">Security settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">Workspace policy for self-hosted deployment.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={form.allowPrivateToolUrls ? "warning" : "success"}>
            {form.allowPrivateToolUrls ? "Private tool URLs allowed" : "Private tool URLs blocked"}
          </Badge>
          <Badge variant={form.redactToolSecrets ? "success" : "danger"}>
            {form.redactToolSecrets ? "Secrets redacted" : "Secrets visible"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Workspace</CardTitle>
              <CardDescription>Origin, retention, and trusted-network policy</CardDescription>
            </div>
            <Button type="button" size="sm" onClick={() => void saveSettings()} disabled={!canSave || saveState === "saving"}>
              <Save aria-hidden="true" />
              {saveState === "saving" ? "Saving..." : "Save settings"}
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="settings-workspace-name">Workspace name</Label>
                <Input
                  id="settings-workspace-name"
                  value={form.workspaceName}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => current && { ...current, workspaceName: event.target.value });
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="settings-public-base-url">Public base URL</Label>
                <Input
                  id="settings-public-base-url"
                  value={form.publicBaseUrl}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => current && { ...current, publicBaseUrl: event.target.value });
                  }}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-allowed-origins">Allowed origins</Label>
              <Textarea
                id="settings-allowed-origins"
                className="min-h-24 font-mono text-xs"
                value={form.allowedOriginsText}
                onChange={(event) => {
                  setSaveState("idle");
                  setForm((current) => current && { ...current, allowedOriginsText: event.target.value });
                }}
              />
            </div>

            <div className="grid gap-4 rounded-md border border-border p-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="settings-recording-retention">Recording retention days</Label>
                <Input
                  id="settings-recording-retention"
                  type="number"
                  min={1}
                  max={3650}
                  value={form.recordingRetentionDays}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => current && { ...current, recordingRetentionDays: Number(event.target.value) });
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="settings-audit-retention">Audit log retention days</Label>
                <Input
                  id="settings-audit-retention"
                  type="number"
                  min={1}
                  max={3650}
                  value={form.auditLogRetentionDays}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => current && { ...current, auditLogRetentionDays: Number(event.target.value) });
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="settings-realtime-ttl">Realtime session TTL seconds</Label>
                <Input
                  id="settings-realtime-ttl"
                  type="number"
                  min={15}
                  max={3600}
                  value={form.realtimeSessionTtlSeconds}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => current && { ...current, realtimeSessionTtlSeconds: Number(event.target.value) });
                  }}
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-md border border-border p-3">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  aria-label="Allow private tool URLs"
                  className="mt-1 h-4 w-4 rounded border-border"
                  checked={form.allowPrivateToolUrls}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => current && { ...current, allowPrivateToolUrls: event.target.checked });
                  }}
                />
                <span className="grid gap-1">
                  <span className="font-medium">Allow private tool URLs</span>
                  <span className="text-xs text-muted-foreground">Permit tools to call localhost and private network services.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  aria-label="Redact tool secrets"
                  className="mt-1 h-4 w-4 rounded border-border"
                  checked={form.redactToolSecrets}
                  onChange={(event) => {
                    setSaveState("idle");
                    setForm((current) => current && { ...current, redactToolSecrets: event.target.checked });
                  }}
                />
                <span className="grid gap-1">
                  <span className="font-medium">Redact tool secrets</span>
                  <span className="text-xs text-muted-foreground">Hide secret request headers in execution logs.</span>
                </span>
              </label>
            </div>

            {saveState === "saved" ? (
              <Badge variant="success">Settings saved</Badge>
            ) : saveState === "failed" ? (
              <Badge variant="danger">Save failed</Badge>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Hardening</CardTitle>
              <CardDescription>Current protection posture</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <StatusRow
                icon={<ShieldCheck aria-hidden="true" />}
                label="Network boundary"
                value={form.allowPrivateToolUrls ? "trusted local mode" : "private URLs blocked"}
                tone={form.allowPrivateToolUrls ? "warning" : "success"}
              />
              <StatusRow
                icon={<LockKeyhole aria-hidden="true" />}
                label="Tool log secrets"
                value={form.redactToolSecrets ? "redacted" : "visible"}
                tone={form.redactToolSecrets ? "success" : "danger"}
              />
              <StatusRow
                icon={<ShieldCheck aria-hidden="true" />}
                label="Recording retention"
                value={`${form.recordingRetentionDays} days`}
                tone="outline"
              />
              <StatusRow
                icon={<ShieldCheck aria-hidden="true" />}
                label="Audit retention"
                value={`${form.auditLogRetentionDays} days`}
                tone="outline"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

function StatusRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "success" | "warning" | "danger" | "outline";
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        <span className="truncate font-medium">{label}</span>
      </span>
      <Badge variant={tone}>{value}</Badge>
    </div>
  );
}

function formFromSettings(settings: WorkspaceSettings): SettingsForm {
  return {
    workspaceName: settings.workspaceName,
    publicBaseUrl: settings.publicBaseUrl,
    allowedOriginsText: settings.allowedOrigins.join("\n"),
    allowPrivateToolUrls: settings.allowPrivateToolUrls,
    redactToolSecrets: settings.redactToolSecrets,
    recordingRetentionDays: settings.recordingRetentionDays,
    auditLogRetentionDays: settings.auditLogRetentionDays,
    realtimeSessionTtlSeconds: settings.realtimeSessionTtlSeconds,
  };
}

function parseOrigins(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  );
}
