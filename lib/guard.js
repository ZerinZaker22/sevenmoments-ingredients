const BANNED_WORDS = /\b(good|bad|toxic|clean|harsh|safe|safely|nourishing|luxurious|transformative|powerhouse|glow-giving|girl|babe|bestie|hun)\b/i;
const SCORING = /%|\b(scores?|scored|ratings?|rated|grades?|percent|percentage)\b/i;
const STOP_OR_BUY = /\b(stop using|switch to|buy|instead of|try instead)\b/i;
const MEDICAL = /\b(diagnos\w*|cures?|heal(s|ing)?|doctor|dermatologist|medical)\b/i;
const EMOJI = /\p{Extended_Pictographic}|️/gu;
const BLOCKED = [BANNED_WORDS, SCORING, STOP_OR_BUY, MEDICAL];

function isBlocked(sentence) {
  return BLOCKED.some((pattern) => pattern.test(sentence));
}

function cleanText(text) {
  return String(text)
    .replace(EMOJI, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !isBlocked(sentence))
    .join(' ');
}

function normalize(name) {
  return name.trim().toLowerCase();
}

function cleanBreakdown(raw, ingredients) {
  const groups = raw.groups
    .map((group) => ({
      label: cleanText(group.label) || 'ingredients',
      ingredients: group.ingredients.map((name) => name.trim()),
      explanation: cleanText(group.explanation),
    }))
    .filter((group) => group.explanation && group.ingredients.length > 0);

  const covered = new Set(groups.flatMap((group) => group.ingredients.map(normalize)));
  const missing = ingredients.filter((name) => !covered.has(normalize(name)));
  if (missing.length > 0) {
    groups.push({
      label: 'the rest',
      ingredients: missing,
      explanation: "we couldn't explain these just now. try decoding the list again.",
    });
  }

  return {
    intro: cleanText(raw.intro).slice(0, 300),
    groups,
    worth_knowing: raw.worth_knowing.map(cleanText).filter(Boolean).slice(0, 8),
  };
}

module.exports = { cleanBreakdown };
