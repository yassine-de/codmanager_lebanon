export function isAddressChangeButtonText(value: unknown): boolean {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return /(?:تعديل العنوان|تغيير العنوان|غير العنوان|غيّر العنوان|change (?:the )?address|edit (?:the )?address|update (?:the )?address|modifier l['’]adresse|changer l['’]adresse)/i.test(text);
}

export function shouldConfirmWithStoredAddress(
  wantsConfirmation: boolean,
  addressIsDeliverable: boolean,
): boolean {
  return wantsConfirmation && addressIsDeliverable;
}
