export function detectSpeechTurn(
  frames: Float32Array[],
  options: { threshold: number },
): { hasSpeech: boolean; peak: number } {
  const peak = frames.reduce((max, frame) => {
    return Math.max(max, ...Array.from(frame, (sample) => Math.abs(sample)));
  }, 0);

  return { hasSpeech: peak >= options.threshold, peak: Number(peak.toFixed(6)) };
}
