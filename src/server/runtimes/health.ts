import type { RuntimeHealthResult } from "./types";

export function mapRuntimeHealth(input: {
  configured: boolean;
  reachable: boolean;
  modelPresent: boolean;
  latencyMs?: number;
}): RuntimeHealthResult {
  if (!input.configured) {
    return { status: "missing_model", reason: "runtime_not_configured" };
  }

  if (!input.reachable) {
    return { status: "unavailable", reason: "runtime_unavailable" };
  }

  if (!input.modelPresent) {
    return { status: "missing_model", reason: "model_not_installed" };
  }

  return input.latencyMs === undefined
    ? { status: "healthy", reason: null }
    : { status: "healthy", reason: null, latencyMs: input.latencyMs };
}
