import {
  Activity,
  AudioWaveform,
  Bot,
  Database,
  Headset,
  FlaskConical,
  Gauge,
  Code2,
  ListChecks,
  LogOut,
  Megaphone,
  Mic,
  Phone,
  Route,
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
  | "campaigns"
  | "operations"
  | "tools"
  | "voice-lab"
  | "knowledge"
  | "evals"
  | "usage"
  | "sdk"
  | "settings";

interface DashboardShellProps {
  activePage: PageId;
  onNavigate(page: PageId): void;
  onLogout?(): void;
  children: React.ReactNode;
}

interface NavigationItem {
  id: PageId;
  label: string;
  icon: LucideIcon;
}

interface NavigationSection {
  label: string;
  items: NavigationItem[];
}

export const pageLabels: Record<PageId, string> = {
  overview: "Overview",
  agents: "Agents",
  "web-voice": "Web Voice",
  phone: "Phone Numbers",
  calls: "Calls",
  campaigns: "Campaigns",
  operations: "Operations",
  tools: "Tools",
  "voice-lab": "Voice Lab",
  knowledge: "Knowledge Base",
  evals: "Evals",
  usage: "Usage",
  sdk: "SDK Playground",
  settings: "Settings",
};

const navigationItems: NavigationItem[] = [
  { id: "overview", label: pageLabels.overview, icon: Activity },
  { id: "web-voice", label: pageLabels["web-voice"], icon: Mic },
  { id: "calls", label: pageLabels.calls, icon: ListChecks },
  { id: "campaigns", label: pageLabels.campaigns, icon: Megaphone },
  { id: "operations", label: pageLabels.operations, icon: Headset },
  { id: "agents", label: pageLabels.agents, icon: Bot },
  { id: "phone", label: pageLabels.phone, icon: Phone },
  { id: "tools", label: pageLabels.tools, icon: Wrench },
  { id: "voice-lab", label: pageLabels["voice-lab"], icon: AudioWaveform },
  { id: "knowledge", label: pageLabels.knowledge, icon: Database },
  { id: "evals", label: pageLabels.evals, icon: FlaskConical },
  { id: "usage", label: pageLabels.usage, icon: Gauge },
  { id: "sdk", label: pageLabels.sdk, icon: Code2 },
  { id: "settings", label: pageLabels.settings, icon: Settings },
];

const navigationSections: NavigationSection[] = [
  {
    label: "Desk",
    items: navigationItems.filter((item) =>
      ["overview", "web-voice", "calls", "campaigns", "operations"].includes(item.id),
    ),
  },
  {
    label: "Setup",
    items: navigationItems.filter((item) =>
      ["agents", "phone", "tools", "knowledge", "voice-lab"].includes(item.id),
    ),
  },
  {
    label: "Review",
    items: navigationItems.filter((item) => ["evals", "usage", "sdk", "settings"].includes(item.id)),
  },
];

const pageDescriptions: Record<PageId, string> = {
  overview: "Live queues, runtime readiness, and renewal work at a glance.",
  agents: "Tune prompts, voices, tools, and model routing.",
  "web-voice": "Start browser calls and test the live agent path.",
  phone: "Manage inbound and outbound numbers.",
  calls: "Review active calls, transcripts, and simulation runs.",
  campaigns: "Build and launch renewal or follow-up call batches.",
  operations: "Resolve customers, tickets, callbacks, and transfers.",
  tools: "Connect business actions used by the voice agent.",
  "voice-lab": "Benchmark and compare Nepali voice providers.",
  knowledge: "Maintain reference material for agent answers.",
  evals: "Run scripted checks against voice-agent behavior.",
  usage: "Inspect capacity and activity totals.",
  sdk: "Exercise API calls during integration work.",
  settings: "Configure security, SIP, runtime, and workspace settings.",
};

export function DashboardShell({ activePage, onNavigate, onLogout, children }: DashboardShellProps) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground md:flex-row">
      <aside className="flex w-full min-w-0 flex-col border-b border-border/80 bg-background md:w-72 md:shrink-0 md:border-b-0 md:border-r">
        <div className="border-b border-border/80 px-4 py-3 md:py-4">
          <LipiVoiceLogo size="sm" />
        </div>

        <nav
          className="flex max-w-full gap-2 overflow-x-auto px-3 py-2 md:block md:flex-1 md:space-y-5 md:overflow-x-visible md:overflow-y-auto md:py-4"
          aria-label="Primary"
        >
          {navigationSections.map((section) => (
            <div key={section.label} className="flex shrink-0 gap-1 md:block md:space-y-1">
              <div className="hidden px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground md:block">
                {section.label}
              </div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activePage;

                return (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    className={cn(
                      "h-9 max-w-44 flex-none justify-start overflow-hidden px-3 text-left text-muted-foreground md:w-full md:max-w-none md:flex-auto md:px-2.5",
                      "hover:bg-muted hover:text-foreground",
                      isActive &&
                        "bg-card font-semibold text-foreground shadow-[inset_3px_0_0_hsl(var(--primary))]",
                    )}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => onNavigate(item.id)}
                  >
                    <Icon aria-hidden="true" />
                    <span className="min-w-0 truncate">{item.label}</span>
                  </Button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 flex-col items-start justify-between gap-3 border-b border-border/80 bg-card/85 px-4 py-3 backdrop-blur sm:flex-row sm:items-center md:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-normal">{pageLabels[activePage]}</h1>
            <p className="mt-0.5 max-w-2xl truncate text-sm text-muted-foreground">{pageDescriptions[activePage]}</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
            <Badge variant="outline" className="gap-1.5">
              <Route className="h-3.5 w-3.5" aria-hidden="true" />
              Ops console
            </Badge>
            <Badge variant="success">Self-hosted stack</Badge>
            {onLogout ? (
              <Button type="button" variant="outline" className="h-8" onClick={onLogout}>
                <LogOut aria-hidden="true" />
                Logout
              </Button>
            ) : null}
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-auto bg-background p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
