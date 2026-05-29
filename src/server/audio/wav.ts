import { readFile } from "node:fs/promises";
import { execa } from "execa";
import ffmpegPath from "ffmpeg-static";

export async function writeWebmToWav(inputPath: string, outputPath: string): Promise<void> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not provide an ffmpeg binary path");
  }

  await execa(ffmpegPath, ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", outputPath]);
}

export async function fileToBase64(path: string): Promise<string> {
  const file = await readFile(path);

  return file.toString("base64");
}
