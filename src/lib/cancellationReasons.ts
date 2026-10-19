export const CANCEL_REASONS = [
  { value: "high_price", label: "High Price" },
  { value: "product_issue", label: "Product Issue" },
  { value: "not_convinced", label: "Not Convinced" },
  { value: "quality_issue", label: "Quality Issue" },
  { value: "other", label: "Other" },
] as const;

export const isKnownCancelReason = (reason?: string | null) =>
  CANCEL_REASONS.some((option) => option.value === reason);

export const resolveCancelReason = (reason: string, note: string) =>
  reason === "other" ? note.trim() : reason;
