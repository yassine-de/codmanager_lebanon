import { describe, expect, it } from "vitest";
import { isKnownCancelReason, resolveCancelReason } from "@/lib/cancellationReasons";

describe("cancellation reasons", () => {
  it("recognizes configured reasons", () => {
    expect(isKnownCancelReason("high_price")).toBe(true);
    expect(isKnownCancelReason("customer_changed_mind")).toBe(false);
  });

  it("stores a selected reason directly", () => {
    expect(resolveCancelReason("quality_issue", "optional note")).toBe("quality_issue");
  });

  it("uses the trimmed note for other", () => {
    expect(resolveCancelReason("other", "  Customer is travelling  ")).toBe("Customer is travelling");
  });
});
