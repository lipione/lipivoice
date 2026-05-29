import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileToBase64, writeWebmToWav } from "./wav";

describe("WAV helpers", () => {
  it("runs ffmpeg with the expected WebM to WAV arguments", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const runner = async (file: string, args: readonly string[]) => {
      calls.push({ file, args });
    };

    await writeWebmToWav("/tmp/input.webm", "/tmp/output.wav", {
      ffmpegPath: "/bin/ffmpeg",
      runner,
    });

    expect(calls).toEqual([
      {
        file: "/bin/ffmpeg",
        args: ["-y", "-i", "/tmp/input.webm", "-ac", "1", "-ar", "16000", "/tmp/output.wav"],
      },
    ]);
  });

  it("throws a clear error when ffmpeg-static does not provide a binary path", async () => {
    await expect(
      writeWebmToWav("/tmp/input.webm", "/tmp/output.wav", {
        ffmpegPath: null,
        runner: async () => undefined,
      }),
    ).rejects.toThrow("ffmpeg-static did not provide an ffmpeg binary path");
  });

  it("wraps ffmpeg conversion failures with context", async () => {
    await expect(
      writeWebmToWav("/tmp/input.webm", "/tmp/output.wav", {
        ffmpegPath: "/bin/ffmpeg",
        runner: async () => {
          throw new Error("invalid data found");
        },
      }),
    ).rejects.toThrow("Failed to convert WebM to WAV: invalid data found");
  });

  it("reads a file as base64 audio content", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "lipivoice-wav-test-"));
    const filePath = join(tempDir, "speech.wav");

    try {
      await writeFile(filePath, Buffer.from([1, 2, 3, 4]));

      await expect(fileToBase64(filePath)).resolves.toBe(Buffer.from([1, 2, 3, 4]).toString("base64"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
