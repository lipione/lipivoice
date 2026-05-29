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

import { LipiVoiceLogo } from "@/components/brand/LipiVoiceLogo";
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
  phone: "Phone Numbers",
  calls: "Calls",
  tools: "Tools",
  "voice-lab": "Voice Lab",
  knowledge: "Knowledge Base",
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
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground md:flex-row">
      <aside className="flex w-full min-w-0 flex-col border-b border-border bg-card md:w-72 md:shrink-0 md:border-b-0 md:border-r">
        <div className="border-b border-border bg-white px-4 py-3 md:py-4">
          <LipiVoiceLogo size="sm" />
        </div>

        <nav
          className="flex max-w-full gap-1 overflow-x-auto px-3 py-2 md:block md:flex-1 md:space-y-1 md:overflow-x-visible md:overflow-y-auto md:py-3"
          aria-label="Primary"
        >
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activePage;

            return (
              <Button
                key={item.id}
                type="button"
                variant={isActive ? "secondary" : "ghost"}
                className={cn(
                  "h-9 max-w-44 flex-none justify-start overflow-hidden px-3 text-left text-muted-foreground md:w-full md:max-w-none md:flex-auto md:px-2.5",
                  "hover:bg-brand-violetSoft hover:text-brand-ink",
                  isActive &&
                    "bg-brand-violetSoft font-semibold text-brand-ink shadow-[inset_3px_0_0_#5B46E8]",
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
        <header className="flex min-h-16 flex-col items-start justify-between gap-3 border-b border-border bg-white/80 px-4 py-3 backdrop-blur sm:flex-row sm:items-center md:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-normal">{pageLabels[activePage]}</h1>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
            <Badge variant="outline">Open-source</Badge>
            <Badge variant="secondary" className="bg-brand-violetSoft text-brand-violet">
              Self-hosted
            </Badge>
            <Badge variant="success">Voice ready</Badge>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_top_right,rgba(91,70,232,0.08),transparent_28rem),linear-gradient(180deg,#F8F9FC_0%,#F4F6FA_100%)] p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
