import {
  Activity,
  AudioWaveform,
  Bot,
  Database,
  FlaskConical,
  Gauge,
  ListChecks,
  Mic,
  Phone,
  Settings,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PageId =
  | "overview"
  | "agents"
  | "web-voice"
  | "phone"
  | "calls"
  | "tools"
  | "voice-lab"
  | "knowledge"
  | "evals"
  | "usage"
  | "settings";

interface DashboardShellProps {
  activePage: PageId;
  onNavigate(page: PageId): void;
  children: React.ReactNode;
}

interface NavigationItem {
  id: PageId;
  label: string;
  icon: LucideIcon;
}

export const pageLabels: Record<PageId, string> = {
  overview: "Overview",
  agents: "Agents",
  "web-voice": "Web Voice",
  phone: "Phone",
  calls: "Calls",
  tools: "Tools",
  "voice-lab": "Voice Lab",
  knowledge: "Knowledge",
  evals: "Evals",
  usage: "Usage",
  settings: "Settings",
};

const navigationItems: NavigationItem[] = [
  { id: "overview", label: pageLabels.overview, icon: Activity },
  { id: "agents", label: pageLabels.agents, icon: Bot },
  { id: "web-voice", label: pageLabels["web-voice"], icon: Mic },
  { id: "phone", label: pageLabels.phone, icon: Phone },
  { id: "calls", label: pageLabels.calls, icon: ListChecks },
  { id: "tools", label: pageLabels.tools, icon: Wrench },
  { id: "voice-lab", label: pageLabels["voice-lab"], icon: AudioWaveform },
  { id: "knowledge", label: pageLabels.knowledge, icon: Database },
  { id: "evals", label: pageLabels.evals, icon: FlaskConical },
  { id: "usage", label: pageLabels.usage, icon: Gauge },
  { id: "settings", label: pageLabels.settings, icon: Settings },
];

export function DashboardShell({ activePage, onNavigate, children }: DashboardShellProps) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-4 py-4">
          <div className="text-base font-semibold leading-6">LipiVoice</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Local runtime</div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label="Primary">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activePage;

            return (
              <Button
                key={item.id}
                type="button"
                variant={isActive ? "secondary" : "ghost"}
                className={cn(
                  "h-9 w-full justify-start overflow-hidden px-2.5 text-left",
                  isActive && "bg-muted font-semibold",
                )}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <Icon aria-hidden="true" />
                <span className="min-w-0 truncate">{item.label}</span>
              </Button>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border bg-background px-6">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-normal">{pageLabels[activePage]}</h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Badge variant="outline">Open-source</Badge>
            <Badge variant="success">Local first</Badge>
            <Badge variant="warning">Phone simulated</Badge>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-auto bg-muted/30 p-6">{children}</main>
      </div>
    </div>
  );
}
