import { readFile } from "node:fs/promises";
import { execa } from "execa";
import ffmpegPath from "ffmpeg-static";

type FfmpegRunner = (file: string, args: readonly string[]) => Promise<unknown>;

interface WriteWebmToWavOptions {
  ffmpegPath?: string | null;
  runner?: FfmpegRunner;
}

export async function writeWebmToWav(
  inputPath: string,
  outputPath: string,
  options: WriteWebmToWavOptions = {},
): Promise<void> {
  const binaryPath = Object.hasOwn(options, "ffmpegPath") ? options.ffmpegPath : ffmpegPath;
  const runner = options.runner ?? execa;

  if (!binaryPath) {
    throw new Error("ffmpeg-static did not provide an ffmpeg binary path");
  }

  try {
    await runner(binaryPath, ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", outputPath]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to convert WebM to WAV: ${message}`, { cause: error });
  }
}

export async function fileToBase64(path: string): Promise<string> {
  const file = await readFile(path);

  return file.toString("base64");
}
