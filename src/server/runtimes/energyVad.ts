export function detectSpeechTurn(
  frames: Float32Array[],
  options: { threshold: number },
): { hasSpeech: boolean; peak: number } {
  let peak = 0;

  for (const frame of frames) {
    for (const sample of frame) {
      const samplePeak = Math.abs(sample);

      if (samplePeak > peak) {
        peak = samplePeak;
      }
    }
  }

  return { hasSpeech: peak >= options.threshold, peak: Number(peak.toFixed(6)) };
}
