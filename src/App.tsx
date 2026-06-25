import { useEffect, useState, type FormEvent } from "react";

import { apiPath, authHeaders, setAdminToken } from "@/client/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AgentsPage } from "@/features/agents/AgentsPage";
import { CallsPage } from "@/features/calls/CallsPage";
import { CampaignsPage } from "@/features/campaigns/CampaignsPage";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { OperationsPage } from "@/features/operations/OperationsPage";
import { PhoneNumbersPage } from "@/features/phone/PhoneNumbersPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { DashboardShell, type PageId, pageLabels } from "@/features/shell/DashboardShell";

const pageIds = new Set<PageId>([
  "overview",
  "agents",
  "phone",
  "calls",
  "campaigns",
  "operations",
  "settings",
]);

function pageFromPath(pathname: string): PageId {
  const segment = pathname.split("/").filter(Boolean).at(-1);
  return segment && pageIds.has(segment as PageId) ? (segment as PageId) : "overview";
}

export function App() {
  const [activePage, setActivePage] = useState<PageId>(() => pageFromPath(window.location.pathname));
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "required" | "failed">("checking");
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const activeLabel = pageLabels[activePage];

  useEffect(() => {
    void checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const response = await fetch(apiPath("/api/auth/status"), { headers: authHeaders() });
      const body = (await response.json()) as { required?: boolean; authenticated?: boolean };
      setAuthState(body.authenticated ? "authenticated" : body.required ? "required" : "authenticated");
      setAuthError(null);
    } catch {
      setAuthState("failed");
      setAuthError("auth_status_failed");
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);

    if (!usernameInput.trim() || !passwordInput) {
      setAuthError("username_password_required");
      return;
    }

    const response = await fetch(apiPath("/api/auth/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: usernameInput.trim(), password: passwordInput }),
    });

    if (!response.ok) {
      setAdminToken("");
      setAuthState("required");
      setAuthError(response.status === 409 ? "password_login_not_configured" : "invalid_credentials");
      return;
    }

    const body = (await response.json()) as { token?: string };
    if (!body.token) {
      setAuthError("login_token_missing");
      return;
    }

    setAdminToken(body.token);
    setAuthState("authenticated");
    setPasswordInput("");
    setAuthError(null);
  }

  function logout() {
    setAdminToken("");
    setPasswordInput("");
    setAuthState("required");
    const basePath = window.location.pathname.startsWith("/voice") ? "/voice" : "";
    window.history.pushState(null, "", `${basePath}/login`);
  }

  if (authState === "checking") {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>LipiVoice</CardTitle>
            <CardDescription>Checking admin access</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  if (authState === "required" || authState === "failed") {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>LipiVoice Admin</CardTitle>
            <CardDescription>Sign in to manage calls, agents, and operations.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={(event) => void submitLogin(event)}>
              <div className="grid gap-2">
                <Label htmlFor="admin-username">Username</Label>
                <Input
                  id="admin-username"
                  type="text"
                  autoComplete="username"
                  value={usernameInput}
                  onChange={(event) => setUsernameInput(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="admin-password">Password</Label>
                <Input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                />
              </div>
              {authError ? <p className="text-sm font-medium text-red-700">{authError}</p> : null}
              <Button type="submit">Login</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  function navigate(page: PageId) {
    setActivePage(page);
    const basePath = window.location.pathname.startsWith("/voice") ? "/voice" : "";
    window.history.pushState(null, "", `${basePath}/${page === "overview" ? "" : page}`.replace(/\/$/, "") || "/");
  }

  return (
    <DashboardShell activePage={activePage} onNavigate={navigate} onLogout={logout}>
      {activePage === "overview" ? (
        <OverviewPage />
      ) : activePage === "agents" ? (
        <AgentsPage />
      ) : activePage === "phone" ? (
        <PhoneNumbersPage />
      ) : activePage === "calls" ? (
        <CallsPage />
      ) : activePage === "campaigns" ? (
        <CampaignsPage />
      ) : activePage === "operations" ? (
        <OperationsPage />
      ) : activePage === "settings" ? (
        <SettingsPage />
      ) : (
        <section className="mx-auto w-full max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle>{activeLabel}</CardTitle>
              <CardDescription>This operational panel will be wired in a later task.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">No configuration changes are available here yet.</p>
            </CardContent>
          </Card>
        </section>
      )}
    </DashboardShell>
  );
}
