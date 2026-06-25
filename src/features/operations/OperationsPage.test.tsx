import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperationsPage } from "./OperationsPage";

describe("OperationsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders customers, tickets, callbacks, and transfers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/customers")) {
          return Response.json([
            {
              id: "cust_1",
              name: "Sita Shrestha",
              phoneNumber: "9779801234567",
              email: null,
              address: "",
              preferredLanguage: "ne-NP",
              notes: "",
              source: "voice_call",
              createdAt: "2026-06-02T01:00:00.000Z",
              updatedAt: "2026-06-02T01:00:00.000Z",
              lastCallId: "call_1",
            },
          ]);
        }

        if (url.endsWith("/api/tickets")) {
          return Response.json([
            {
              id: "tkt_1",
              customerId: "cust_1",
              callId: "call_1",
              type: "complaint",
              status: "open",
              priority: "urgent",
              subject: "Claim follow-up",
              description: "Caller needs supervisor review.",
              source: "voice_call",
              createdAt: "2026-06-02T01:00:00.000Z",
              updatedAt: "2026-06-02T01:00:00.000Z",
            },
          ]);
        }

        if (url.endsWith("/api/appointments")) {
          return Response.json([
            {
              id: "apt_1",
              customerId: "cust_1",
              callId: "call_1",
              callerName: "Sita Shrestha",
              phoneNumber: "9779801234567",
              scheduledAt: null,
              preferredTime: "tomorrow morning",
              reason: "renewal",
              status: "scheduled",
              createdAt: "2026-06-02T01:00:00.000Z",
              updatedAt: "2026-06-02T01:00:00.000Z",
            },
          ]);
        }

        if (url.endsWith("/api/transfers")) {
          return Response.json([
            {
              id: "trn_1",
              customerId: "cust_1",
              callId: "call_1",
              department: "claims",
              reason: "claim question",
              status: "queued",
              warmTransferAvailable: false,
              createdAt: "2026-06-02T01:00:00.000Z",
              updatedAt: "2026-06-02T01:00:00.000Z",
            },
          ]);
        }

        return Response.json([]);
      }),
    );

    render(<OperationsPage />);

    expect(await screen.findAllByText("Sita Shrestha")).toHaveLength(2);
    expect(screen.getByText("Claim follow-up")).toBeInTheDocument();
    expect(screen.getByText("tomorrow morning")).toBeInTheDocument();
    expect(screen.getByText("claims")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Operations")).getByText("1 open tickets")).toBeInTheDocument();
  });
});
