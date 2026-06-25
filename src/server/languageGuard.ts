export const unsupportedLanguageClarification =
  "माफ गर्नुहोस्, म नेपाली वा English मा मात्रै सहयोग गर्न सक्छु। कृपया नेपाली वा English मा भन्नुहुन्छ?";
export const unsupportedLanguageIntakeFallback =
  "हजुर, म तपाईंको विवरण नोट गरेर कर्मचारीबाट फिर्ता सम्पर्क गराउँछु। कृपया आफ्नो नाम, फोन नम्बर, र policy वा claim number भन्नुहोस्।";
export const unsupportedLanguageIntakeInstruction = [
  "The caller is still unclear after one clarification.",
  "This instruction overrides the earlier unsupported-language clarification rule.",
  "Do not guess their insurance type or repeat the same clarification.",
  "Do not say the earlier Nepali-or-English clarification again.",
  "Naturally move to callback or policy intake in Nepali or natural Nepali-English.",
  "Ask for the caller's name, phone number, and policy number or claim number.",
  "Keep it to one or two short phone-friendly sentences.",
].join(" ");

const unsupportedLanguageHints = new Set(["newari", "newar", "newa", "hindi", "hi"]);

const unsupportedSpeechFragments = [
  "पति पार्स तो इंचरेंस गरिक्प",
  "उड़ा इन्सुर्यन्स गौन",
  "ति पार्सा",
  "गौन रुपो",
  "जिवन्ने मैले",
  "गरिक्प",
  "गौन",
];

export function unsupportedLanguageResponse(text: string, language = "", previousUnsupportedTurns = 0): string | null {
  if (!isUnsupportedLanguageTurn(text, language) || previousUnsupportedTurns > 0) {
    return null;
  }

  return unsupportedLanguageClarification;
}

export function unsupportedLanguageIntakeInstructionForTurn(
  text: string,
  language = "",
  previousUnsupportedTurns = 0,
): string | null {
  return isUnsupportedLanguageTurn(text, language) && previousUnsupportedTurns > 0
    ? unsupportedLanguageIntakeInstruction
    : null;
}

export function countUnsupportedUserTurns(texts: string[]) {
  return texts.filter(isUnsupportedSpeech).length;
}

export function repeatsUnsupportedLanguageClarification(text: string) {
  const normalizedText = normalizeSpeech(text).toLowerCase();
  const normalizedClarification = normalizeSpeech(unsupportedLanguageClarification).toLowerCase();

  return (
    normalizedText === normalizedClarification ||
    (normalizedText.includes("नेपाली वा english मा मात्रै") && normalizedText.includes("english मा भन्नुहुन्छ"))
  );
}

function isUnsupportedLanguageTurn(text: string, language = "") {
  const normalizedLanguage = language.trim().toLowerCase();
  return unsupportedLanguageHints.has(normalizedLanguage) || isUnsupportedSpeech(text);
}

function isUnsupportedSpeech(text: string) {
  const normalizedText = normalizeSpeech(text);
  if (!normalizedText) {
    return false;
  }

  return unsupportedSpeechFragments.some((fragment) => normalizedText.includes(normalizeSpeech(fragment)));
}

function normalizeSpeech(text: string) {
  return text
    .trim()
    .replace(/[।.,!?;:]+/g, " ")
    .replace(/\s+/g, " ");
}
