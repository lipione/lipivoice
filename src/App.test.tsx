import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { getAdminToken, setAdminToken } from "./client/api";

function stubAuthenticatedApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/auth/status")) {
        return Response.json({ authenticated: true, required: true });
      }

      if (url.includes("/api/calls")) {
        return Response.json([]);
      }

      if (
        url.includes("/api/customers") ||
        url.includes("/api/tickets") ||
        url.includes("/api/appointments") ||
        url.includes("/api/transfers") ||
        url.includes("/api/campaigns")
      ) {
        return Response.json([]);
      }

      if (url.includes("/api/model-runtimes")) {
        return Response.json([]);
      }

      if (url.includes("/api/model-assets")) {
        return Response.json([]);
      }

      if (url.includes("/api/voices")) {
        return Response.json([]);
      }

      if (url.includes("/api/agents")) {
        return Response.json([
          {
            id: "agent_1",
            name: "Sarita",
            greeting: "Namaste",
            systemPrompt: "Insurance receptionist",
            language: "ne-NP",
            voiceId: "google-kore",
          },
        ]);
      }

      return Response.json({});
    }),
  );
}

describe("App routing", () => {
  afterEach(() => {
    cleanup();
    setAdminToken("");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.pushState(null, "", "/");
  });

  it("opens the Calls page from the hosted /voice/calls path", async () => {
    stubAuthenticatedApi();
    window.history.pushState(null, "", "/voice/calls");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Calls" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Start demo call" })).toBeInTheDocument();
  });

  it("updates the hosted path when navigating from the sidebar", async () => {
    const user = userEvent.setup();
    stubAuthenticatedApi();
    window.history.pushState(null, "", "/voice");

    render(<App />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "Calls" })[0]);

    expect(window.location.pathname).toBe("/voice/calls");
  });

  it("falls back to overview for internal pages removed from the dashboard", async () => {
    stubAuthenticatedApi();
    window.history.pushState(null, "", "/voice/sdk");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "SDK Playground" })).not.toBeInTheDocument();
  });

  it("logs in with username and password when admin auth is required", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/api/auth/status")) {
          const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
          return Response.json({ authenticated: authorization === "Bearer admin-token", required: true });
        }

        if (url.includes("/api/auth/login")) {
          const body = JSON.parse(String(init?.body));
          return body.username === "admin" && body.password === "secret"
            ? Response.json({ token: "admin-token" })
            : Response.json({ code: "invalid_credentials" }, { status: 401 });
        }

        return Response.json([]);
      }),
    );
    window.history.pushState(null, "", "/voice/login");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "LipiVoice Admin" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() => expect(screen.getAllByRole("heading", { name: "Overview" }).length).toBeGreaterThan(0));
    expect(getAdminToken()).toBe("admin-token");
  });
});
