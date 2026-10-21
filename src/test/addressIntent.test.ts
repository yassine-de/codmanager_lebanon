import { describe, expect, it } from "vitest";
import { isAddressChangeButtonText } from "../../supabase/functions/_shared/address-intent";

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
