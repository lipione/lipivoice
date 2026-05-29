import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { mapRuntimeHealth } from "./health";
import type { RuntimeHealthResult, SttAdapter } from "./types";

interface WhisperCppAdapterOptions {
  binPath: string;
  modelPath: string;
  runner?: typeof execa;
}

export class WhisperCppAdapter implements SttAdapter {
  private readonly binPath: string;
  private readonly modelPath: string;
  private readonly runner: typeof execa;

  constructor(options: WhisperCppAdapterOptions) {
    this.binPath = options.binPath;
    this.modelPath = options.modelPath;
    this.runner = options.runner ?? execa;
  }

  async health(): Promise<RuntimeHealthResult> {
    const configured = Boolean(this.binPath && this.modelPath);

    return mapRuntimeHealth({
      configured,
      reachable: configured && existsSync(this.binPath),
      modelPresent: configured && existsSync(this.modelPath),
    });
  }

  async transcribe(input: { wavPath: string; language: string }): Promise<{ text: string; confidence: number | null }> {
    const tempDir = await mkdtemp(join(tmpdir(), "lipivoice-whisper-"));
    const outputBase = join(tempDir, "transcript");

    try {
      await this.runner(this.binPath, [
        "-m",
        this.modelPath,
        "-f",
        input.wavPath,
        "-l",
        input.language,
        "-otxt",
        "-of",
        outputBase,
      ]);

      const text = await readFile(`${outputBase}.txt`, "utf8");

      return { text: text.trim(), confidence: null };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
