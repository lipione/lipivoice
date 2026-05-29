import { Activity } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { runtimeHealthTone } from "@/domain/status";
import type { ConfiguredState, RuntimeAdapter, RuntimeHealthStatus } from "@/domain/types";

export interface RuntimeHealthRecord {
  id: string;
  adapter: RuntimeAdapter | string;
  configuredState: ConfiguredState | string;
  healthStatus: RuntimeHealthStatus;
}

interface RuntimeHealthPanelProps {
  runtimes: RuntimeHealthRecord[];
}

export function RuntimeHealthPanel({ runtimes }: RuntimeHealthPanelProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle>Runtime health</CardTitle>
          <CardDescription>Configured local model adapters</CardDescription>
        </div>
        <Activity className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        {runtimes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runtimes reported.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="whitespace-nowrap px-0 py-2 pr-3 font-medium">Adapter</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Configured</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Health</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runtimes.map((runtime) => {
                  const health = runtimeHealthTone(runtime.healthStatus);

                  return (
                    <tr key={runtime.id}>
                      <td className="whitespace-nowrap px-0 py-2 pr-3 font-medium">{runtime.adapter}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {runtime.configuredState.replace("_", " ")}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Badge variant={health.tone === "muted" ? "secondary" : health.tone}>{health.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
