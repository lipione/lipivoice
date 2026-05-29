import type { CallStatus, RuntimeHealthStatus } from "./types";

type RuntimeHealthTone = {
  label: string;
  tone: "success" | "warning" | "danger" | "muted";
};

export function callStatusLabel(status: CallStatus) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function runtimeHealthTone(status: RuntimeHealthStatus): RuntimeHealthTone {
  const labels: Record<RuntimeHealthStatus, RuntimeHealthTone> = {
    unknown: { label: "Unchecked", tone: "muted" },
    healthy: { label: "Healthy", tone: "success" },
    unavailable: { label: "Unavailable", tone: "danger" },
    missing_model: { label: "Model missing", tone: "warning" },
    license_required: { label: "License required", tone: "warning" },
    failed: { label: "Failed", tone: "danger" },
  };

  return labels[status];
}
