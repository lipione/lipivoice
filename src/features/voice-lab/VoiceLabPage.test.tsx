import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceLabPage } from "./VoiceLabPage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

describe("VoiceLabPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows local TTS controls", () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));

    render(<VoiceLabPage />);

    expect(screen.getByLabelText("Text")).toBeInTheDocument();
    expect(screen.getByLabelText("Voice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate speech" })).toBeInTheDocument();
  });

  it("loads voices from the API and posts the selected voice to TTS", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/voices") {
        return Response.json([
          {
            id: "voice_lipi_ml_en",
            name: "Lipi ML English",
            runtimeId: "runtime_lipi_ml_tts",
            type: "builtin",
            language: "en-US",
            tags: [],
            previewUrl: "",
            privacy: "workspace",
            cloneStatus: "not_clone",
            consentId: null,
          },
          {
            id: "voice_lipi_ml_ne",
            name: "Lipi ML Nepali",
            runtimeId: "runtime_lipi_ml_tts",
            type: "builtin",
            language: "ne-NP",
            tags: [],
            previewUrl: "",
            privacy: "workspace",
            cloneStatus: "not_clone",
            consentId: null,
          },
        ]);
      }

      return Response.json({ audioBase64: "UklGRg==", mimeType: "audio/wav" });
    });
    vi.stubGlobal("fetch", fetch);

    render(<VoiceLabPage />);

    expect(await screen.findByRole("option", { name: "Lipi ML English - en-US" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Text"), "Hello local voice");
    await user.click(screen.getByRole("button", { name: "Generate speech" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/tts/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "Hello local voice", voiceId: "voice_lipi_ml_en" }),
      }),
    );
    expect(await screen.findByLabelText("Generated speech")).toHaveAttribute(
      "src",
      "data:audio/wav;base64,UklGRg==",
    );
  });

  it("displays runtime_not_configured from the TTS endpoint", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/voices"
          ? Response.json([
              {
                id: "voice_lipi_ml_en",
                name: "Lipi ML English",
                runtimeId: "runtime_lipi_ml_tts",
                type: "builtin",
                language: "en-US",
                tags: [],
                previewUrl: "",
                privacy: "workspace",
                cloneStatus: "not_clone",
                consentId: null,
              },
            ])
          : Response.json({ code: "runtime_not_configured" }, { status: 409 }),
      ),
    );

    render(<VoiceLabPage />);

    await screen.findByRole("option", { name: "Lipi ML English - en-US" });
    await user.type(screen.getByLabelText("Text"), "Hello");
    await user.click(screen.getByRole("button", { name: "Generate speech" }));

    expect(await screen.findByText("runtime_not_configured")).toBeInTheDocument();
  });

  it("shows which submitted prompt generated the returned audio", async () => {
    const user = userEvent.setup();
    const speech = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/voices"
          ? Response.json([
              {
                id: "voice_lipi_ml_en",
                name: "Lipi ML English",
                runtimeId: "runtime_lipi_ml_tts",
                type: "builtin",
                language: "en-US",
                tags: [],
                previewUrl: "",
                privacy: "workspace",
                cloneStatus: "not_clone",
                consentId: null,
              },
            ])
          : String(input) === "/api/voice-samples"
            ? Response.json([])
            : speech.promise,
      ),
    );

    render(<VoiceLabPage />);

    await screen.findByRole("option", { name: "Lipi ML English - en-US" });
    await user.type(screen.getByLabelText("Text"), "Hello");
    await user.click(screen.getByRole("button", { name: "Generate speech" }));
    await user.type(screen.getByLabelText("Text"), " after edit");

    speech.resolve(Response.json({ audioBase64: "UklGRg==", mimeType: "audio/wav" }));

    expect(await screen.findByText('Generated from "Hello" with Lipi ML English')).toBeInTheDocument();
  });

  it("loads sample history and prepends generated clips", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url === "/api/voices") {
          return Response.json([
            {
              id: "voice_lipi_ml_en",
              name: "Lipi ML English",
              runtimeId: "runtime_lipi_ml_tts",
              type: "builtin",
              language: "en-US",
              tags: [],
              previewUrl: "",
              privacy: "workspace",
              cloneStatus: "not_clone",
              consentId: null,
            },
          ]);
        }

        if (url === "/api/voice-samples") {
          return Response.json([
            {
              id: "sample_old",
              voiceId: "voice_lipi_ml_en",
              voiceName: "Lipi ML English",
              text: "Previous sample",
              audioBase64: "UklGRg==",
              mimeType: "audio/wav",
              createdAt: "2026-05-31T00:00:00.000Z",
            },
          ]);
        }

        return Response.json({
          id: "sample_new",
          voiceId: "voice_lipi_ml_en",
          voiceName: "Lipi ML English",
          text: "New clip",
          audioBase64: "UklGRw==",
          mimeType: "audio/wav",
          createdAt: "2026-05-31T00:01:00.000Z",
        });
      }),
    );

    render(<VoiceLabPage />);

    expect(await screen.findByText("Previous sample")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Text"), "New clip");
    await user.click(screen.getByRole("button", { name: "Generate speech" }));

    expect(await screen.findByText('Generated from "New clip" with Lipi ML English')).toBeInTheDocument();
    expect(screen.getAllByText("New clip").length).toBeGreaterThan(0);
  });

  it("creates consent-gated clone requests and adds the private voice", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/voices") {
        return Response.json([
          {
            id: "voice_lipi_ml_en",
            name: "Lipi ML English",
            runtimeId: "runtime_lipi_ml_tts",
            type: "builtin",
            language: "en-US",
            tags: [],
            previewUrl: "",
            privacy: "workspace",
            cloneStatus: "not_clone",
            consentId: null,
          },
        ]);
      }

      if (url === "/api/voice-samples") {
        return Response.json([]);
      }

      if (url === "/api/voice-clones") {
        expect(init?.body).toBe(JSON.stringify({
          voiceName: "Private Asha",
          language: "en-US",
          speakerName: "Asha",
          consentSource: "Written release stored in workspace.",
          auditNotes: "Approved for internal testing.",
        }));
        return Response.json(
          {
            voice: {
              id: "voice_clone_private_asha",
              name: "Private Asha",
              runtimeId: "runtime_lipi_ml_tts",
              type: "cloned",
              language: "en-US",
              tags: ["cloned", "consent-recorded"],
              previewUrl: "",
              privacy: "private",
              cloneStatus: "pending",
              consentId: "consent_private_asha",
            },
            consent: {
              id: "consent_private_asha",
              voiceId: "voice_clone_private_asha",
              speakerName: "Asha",
              consentSource: "Written release stored in workspace.",
              capturedAt: "2026-05-31T00:00:00.000Z",
              termsVersion: "lipivoice-consent-v1",
              auditNotes: "Approved for internal testing.",
            },
          },
          { status: 201 },
        );
      }

      return Response.json({ code: "not_found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    render(<VoiceLabPage />);

    await user.type(await screen.findByLabelText("Clone name"), "Private Asha");
    await user.type(screen.getByLabelText("Speaker name"), "Asha");
    await user.type(screen.getByLabelText("Consent source"), "Written release stored in workspace.");
    await user.type(screen.getByLabelText("Audit notes"), "Approved for internal testing.");
    await user.click(screen.getByRole("button", { name: "Create clone request" }));

    expect(await screen.findByText("Private Asha")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Private Asha - en-US" })).toBeInTheDocument();
  });
});
