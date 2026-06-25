type VoiceLabelInput = { name?: string; language?: string; tags?: string[] };

function tagsForVoice(voice: { tags?: string[] }) {
  return Array.isArray(voice.tags) ? voice.tags : [];
}

export function voiceTonalityLabel(voice: { language?: string; tags?: string[] }) {
  const tags = tagsForVoice(voice);
  const language = voice.language ?? "";

  if (tags.includes("native-target")) {
    return "Nepali-native target";
  }
  if (tags.includes("accent-review")) {
    return "Preview - accent review";
  }
  if (tags.includes("managed-preview")) {
    return "Preview voice";
  }
  if (language.startsWith("ne")) {
    return "Nepali voice";
  }

  return language ? "Non-Nepali" : "Voice";
}

export function formatVoiceOption(voice: VoiceLabelInput, providerLabel?: string) {
  return [voice.name ?? "Voice", voice.language, voiceTonalityLabel(voice), providerLabel]
    .filter(Boolean)
    .join(" - ");
}

export function voiceDisplayRank(voice: VoiceLabelInput) {
  const tags = tagsForVoice(voice);
  const language = voice.language ?? "";

  if (tags.includes("native-target")) {
    return 0;
  }
  if (language.startsWith("ne") && !tags.includes("accent-review")) {
    return 1;
  }
  if (language.startsWith("ne")) {
    return 2;
  }
  return 3;
}

export function sortVoicesForDisplay<T extends VoiceLabelInput>(voices: T[]) {
  return [...voices].sort(
    (left, right) =>
      voiceDisplayRank(left) - voiceDisplayRank(right) ||
      (left.name ?? "").localeCompare(right.name ?? ""),
  );
}
