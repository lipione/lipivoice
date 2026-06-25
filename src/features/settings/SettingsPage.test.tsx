import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage";

const settings = {
  id: "workspace_settings",
  workspaceName: "LipiVoice",
  publicBaseUrl: "http://127.0.0.1:8787",
  allowedOrigins: ["http://127.0.0.1:8787"],
  allowPrivateToolUrls: false,
  redactToolSecrets: true,
  recordingRetentionDays: 30,
  auditLogRetentionDays: 90,
  realtimeSessionTtlSeconds: 60,
  sipTrunk: {
    enabled: false,
    provider: "",
    mode: "asterisk",
    sipServer: "",
    outboundProxy: "",
    domain: "",
    username: "",
    authUsername: "",
    fromNumber: "",
    transport: "udp",
  },
  createdAt: "2026-05-31T00:00:00.000Z",
  updatedAt: "2026-05-31T00:00:00.000Z",
};

describe("SettingsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves workspace security settings", async () => {
    const user = userEvent.setup();
    let savedSettings: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/api/settings") && init?.method === "POST") {
          savedSettings = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json(savedSettings);
        }

        if (url.endsWith("/api/settings")) {
          return Response.json(settings);
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<SettingsPage />);

    expect(await screen.findByText("Security settings")).toBeInTheDocument();
    expect(screen.getByText("Private tool URLs blocked")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Production" } });
    fireEvent.change(screen.getByLabelText("Public base URL"), {
      target: { value: "https://voice.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Allowed origins"), {
      target: { value: "https://voice.example.com\nhttp://127.0.0.1:8787" },
    });
    fireEvent.change(screen.getByLabelText("Recording retention days"), { target: { value: "14" } });
    await user.click(screen.getByRole("checkbox", { name: "Allow private tool URLs" }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(savedSettings).toMatchObject({
        workspaceName: "Production",
        publicBaseUrl: "https://voice.example.com",
        allowedOrigins: ["https://voice.example.com", "http://127.0.0.1:8787"],
        allowPrivateToolUrls: true,
        recordingRetentionDays: 14,
      }),
    );
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();
  });

  it("saves SIP trunk details from the admin settings panel", async () => {
    const user = userEvent.setup();
    let savedSettings: Record<string, unknown> | null = null;
    let savedSecret: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/api/settings/sip-secret") && init?.method === "POST") {
          savedSecret = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({ configured: true, updatedAt: "2026-05-31T00:00:01.000Z" });
        }

        if (url.endsWith("/api/settings") && init?.method === "POST") {
          savedSettings = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json(savedSettings);
        }

        if (url.endsWith("/api/settings")) {
          return Response.json(settings);
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(<SettingsPage />);

    expect((await screen.findAllByText("SIP trunk")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("checkbox", { name: "Enable SIP trunk" }));
    await user.selectOptions(screen.getByLabelText("SIP mode"), "asterisk");
    fireEvent.change(screen.getByLabelText("SIP provider"), { target: { value: "ntc_easy_phone" } });
    fireEvent.change(screen.getByLabelText("SIP server"), { target: { value: "ims.ntc.net.np" } });
    fireEvent.change(screen.getByLabelText("Outbound proxy"), { target: { value: "202.70.74.178:5060" } });
    fireEvent.change(screen.getByLabelText("SIP domain"), { target: { value: "ims.ntc.net.np" } });
    fireEvent.change(screen.getByLabelText("SIP user ID"), { target: { value: "+97760400011" } });
    fireEvent.change(screen.getByLabelText("SIP auth username"), {
      target: { value: "+97760400011@ims.ntc.net.np" },
    });
    fireEvent.change(screen.getByLabelText("SIP password"), { target: { value: "236790_Ntc1" } });
    fireEvent.change(screen.getByLabelText("SIP from number"), { target: { value: "+97760400011" } });
    await user.selectOptions(screen.getByLabelText("SIP transport"), "udp");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(savedSettings).toMatchObject({
        sipTrunk: {
          enabled: true,
          provider: "ntc_easy_phone",
          mode: "asterisk",
          sipServer: "ims.ntc.net.np",
          outboundProxy: "202.70.74.178:5060",
          domain: "ims.ntc.net.np",
          username: "+97760400011",
          authUsername: "+97760400011@ims.ntc.net.np",
          fromNumber: "+97760400011",
          transport: "udp",
        },
      }),
    );
    expect(savedSecret).toEqual({ password: "236790_Ntc1" });
  });
});
