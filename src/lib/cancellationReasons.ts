export const CANCEL_REASONS = [
  { value: "high_price", label: "High Price" },
  { value: "product_issue", label: "Product Issue" },
  { value: "not_convinced", label: "Not Convinced" },
  { value: "quality_issue", label: "Quality Issue" },
  { value: "no_longer_wants", label: "No Longer Wants" },
  { value: "did_not_order", label: "Didn't Order" },
  { value: "ordered_by_mistake", label: "Ordered by Mistake" },
  { value: "other", label: "Other" },
] as const;

export const isKnownCancelReason = (reason?: string | null) =>
  CANCEL_REASONS.some((option) => option.value === reason);

export const resolveCancelReason = (reason: string, note: string) =>
  reason === "other" ? note.trim() : reason;
