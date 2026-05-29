import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentsPage } from "@/features/agents/AgentsPage";
import { OverviewPage } from "@/features/overview/OverviewPage";
import { DashboardShell, type PageId, pageLabels } from "@/features/shell/DashboardShell";
import { VoiceConsolePage } from "@/features/voice/VoiceConsolePage";

export function App() {
  const [activePage, setActivePage] = useState<PageId>("overview");
  const activeLabel = pageLabels[activePage];

  return (
    <DashboardShell activePage={activePage} onNavigate={setActivePage}>
      {activePage === "overview" ? (
        <OverviewPage />
      ) : activePage === "agents" ? (
        <AgentsPage />
      ) : activePage === "web-voice" ? (
        <VoiceConsolePage />
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
