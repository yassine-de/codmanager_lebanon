export function isCancellationRequestText(value: unknown): boolean {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!text) return false;
  if (/(?:don['’]?t|do not|not) cancel|لا تلغي|ما تلغي|مش إلغاء|nicht stornieren/i.test(text)) {
    return false;
  }

  return /(?:\b(?:cancel|cancellation|annul|annuler|stornieren|storno|didn['’]?t order|did not order|not my order|ordered by mistake|by mistake|don['’]?t want (?:it|the order)|do not want (?:it|the order)|no longer want|will nicht mehr|nichts bestellt|nicht bestellt|aus versehen bestellt)\b|إلغاء|الغاء|ألغي|الغي|بدي الغي|ما بدي الطلب|مش بدي الطلب|ما بدي ياه|مش بدي ياه|ما طلبت|مش طلبي|طلبت بالغلط|بالغلط|je ne veux plus|pas command[ée])/i.test(text);
}
