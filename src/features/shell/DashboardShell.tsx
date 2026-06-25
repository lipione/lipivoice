import {
  Activity,
  Bot,
  Headset,
  ListChecks,
  LogOut,
  Megaphone,
  Phone,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type * as React from "react";

import { LipiVoiceLogo } from "@/components/brand/LipiVoiceLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PageId =
  | "overview"
  | "agents"
  | "phone"
  | "calls"
  | "campaigns"
  | "operations"
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
  phone: "Phone Numbers",
  calls: "Calls",
  campaigns: "Campaigns",
  operations: "Operations",
  settings: "Settings",
};

const navigationItems: NavigationItem[] = [
  { id: "overview", label: pageLabels.overview, icon: Activity },
  { id: "calls", label: pageLabels.calls, icon: ListChecks },
  { id: "operations", label: pageLabels.operations, icon: Headset },
  { id: "campaigns", label: pageLabels.campaigns, icon: Megaphone },
  { id: "agents", label: pageLabels.agents, icon: Bot },
  { id: "phone", label: pageLabels.phone, icon: Phone },
  { id: "settings", label: pageLabels.settings, icon: Settings },
];

const navigationSections: NavigationSection[] = [
  {
    label: "Operate",
    items: navigationItems.filter((item) => ["overview", "calls", "operations", "campaigns"].includes(item.id)),
  },
  {
    label: "Configure",
    items: navigationItems.filter((item) => ["agents", "phone", "settings"].includes(item.id)),
  },
];

const pageDescriptions: Record<PageId, string> = {
  overview: "Runtime status and the work waiting for staff.",
  agents: "Tune prompts, voices, tools, and model routing.",
  phone: "Manage SIP numbers and outbound calling setup.",
  calls: "Start calls, review transcripts, and test conversations.",
  campaigns: "Call renewal and follow-up batches.",
  operations: "Resolve customers, tickets, callbacks, and transfers.",
  settings: "Security, runtime, and workspace settings.",
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
