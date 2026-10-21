import { describe, expect, it } from "vitest";
import {
  isAddressChangeButtonText,
  shouldConfirmWithStoredAddress,
} from "../../supabase/functions/_shared/address-intent";

describe("isAddressChangeButtonText", () => {
  it.each([
    "تعديل العنوان",
    "تغيير العنوان",
    "Edit address",
    "Change the address",
    "Modifier l'adresse",
  ])("recognizes an address change request: %s", (label) => {
    expect(isAddressChangeButtonText(label)).toBe(true);
  });

  it.each([
    "نعم، تأكيد الطلب",
    "نعم، صحيح",
    "Confirm order",
    null,
  ])("does not confuse confirmation with address changes: %s", (label) => {
    expect(isAddressChangeButtonText(label)).toBe(false);
  });
});

describe("shouldConfirmWithStoredAddress", () => {
  it("confirms directly when purchase intent and a deliverable address are both present", () => {
    expect(shouldConfirmWithStoredAddress(true, true)).toBe(true);
  });

  it.each([
    [true, false],
    [false, true],
    [false, false],
  ])("does not confirm for wantsConfirmation=%s, deliverable=%s", (intent, deliverable) => {
    expect(shouldConfirmWithStoredAddress(intent, deliverable)).toBe(false);
  });
});
