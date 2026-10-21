import { describe, expect, it } from "vitest";
import { isCancellationRequestText } from "../../supabase/functions/_shared/cancellation-intent";

describe("isCancellationRequestText", () => {
  it.each([
    "ما بدي الطلب",
    "مش طلبي",
    "طلبت بالغلط",
    "I don't want the order",
    "I ordered by mistake",
    "Je veux annuler",
    "Ich will nicht mehr",
    "Ich habe nichts bestellt",
  ])("recognizes a cancellation request: %s", (message) => {
    expect(isCancellationRequestText(message)).toBe(true);
  });

  it.each([
    "Do not cancel my order",
    "لا تلغي الطلب",
    "Bitte nicht stornieren",
    "نعم، تأكيد الطلب",
    "Where is my order?",
  ])("does not misread a non-cancellation message: %s", (message) => {
    expect(isCancellationRequestText(message)).toBe(false);
  });
});
