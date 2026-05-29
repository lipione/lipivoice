import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { mapRuntimeHealth } from "./health";
import type { RuntimeHealthResult, TtsAdapter } from "./types";

interface PiperAdapterOptions {
  binPath: string;
  voicePath: string;
  runner?: typeof execa;
}

export class PiperAdapter implements TtsAdapter {
  private readonly binPath: string;
  private readonly voicePath: string;
  private readonly runner: typeof execa;

  constructor(options: PiperAdapterOptions) {
    this.binPath = options.binPath;
    this.voicePath = options.voicePath;
    this.runner = options.runner ?? execa;
  }

  async health(): Promise<RuntimeHealthResult> {
    const configured = Boolean(this.binPath && this.voicePath);

    return mapRuntimeHealth({
      configured,
      reachable: configured && existsSync(this.binPath),
      modelPresent: configured && existsSync(this.voicePath),
    });
  }

  async synthesize(input: { text: string; voicePath: string }): Promise<{ audioBase64: string; mimeType: "audio/wav" }> {
    const tempDir = await mkdtemp(join(tmpdir(), "lipivoice-piper-"));
    const outPath = join(tempDir, "speech.wav");

    try {
      await this.runner(this.binPath, ["--model", this.voicePath, "--output_file", outPath], {
        input: input.text,
      });

      const audio = await readFile(outPath);

      return { audioBase64: audio.toString("base64"), mimeType: "audio/wav" };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
