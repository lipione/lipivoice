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
});
