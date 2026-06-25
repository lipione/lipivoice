import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CampaignsPage } from "./CampaignsPage";

describe("CampaignsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a scheduled time when building automatic renewal calls", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/campaigns") && !init) return Response.json([]);
      if (path.endsWith("/api/agents")) {
        return Response.json([{ id: "agent_reception", name: "Sarita" }]);
      }
      if (path.endsWith("/api/campaigns/build-renewal")) {
        return Response.json({
          id: "campaign_1",
          name: "Policy Renewal Reminders",
          type: "renewal_reminder",
          status: "scheduled",
          agentId: "agent_reception",
          contacts: [],
          scheduledAt: "2026-07-01T10:30:00.000Z",
          completedAt: null,
          totalContacts: 0,
          dialedCount: 0,
          answeredCount: 0,
          failedCount: 0,
          notes: "",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:00:00.000Z",
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CampaignsPage />);

    await screen.findByText("Outbound campaigns");
    await user.type(screen.getByLabelText("Auto-call at"), "2026-07-01T10:30");
    await user.click(screen.getByRole("button", { name: /Schedule calls/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/campaigns/build-renewal"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    const buildCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/campaigns/build-renewal"));
    expect(JSON.parse(String(buildCall?.[1]?.body))).toMatchObject({
      agentId: "agent_reception",
      withinDays: 30,
      scheduledAt: new Date("2026-07-01T10:30").toISOString(),
    });
  });
});
