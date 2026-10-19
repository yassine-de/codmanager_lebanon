import { describe, expect, it } from "vitest";
import { getProductVariants, hasValidSelectedVariant } from "@/lib/productVariants";

const products = [
  {
    name: "Variant Product",
    variants: [
      { name: "Red", sku: "RED-1" },
      { name: "Blue", sku: "BLUE-1" },
    ],
  },
  { name: "Simple Product", variants: [] },
];

describe("product variant confirmation", () => {
  it("requires a selection when the product has variants", () => {
    expect(hasValidSelectedVariant({ name: "Variant Product" }, products)).toBe(false);
  });

  it("accepts a catalog variant selected by name or SKU", () => {
    expect(hasValidSelectedVariant({ name: "Variant Product", variantName: "Red" }, products)).toBe(true);
    expect(hasValidSelectedVariant({ name: "Variant Product", variantSku: "blue-1" }, products)).toBe(true);
  });

  it("rejects a variant that does not belong to the product", () => {
    expect(hasValidSelectedVariant({ name: "Variant Product", variantName: "Green" }, products)).toBe(false);
  });

  it("does not require a variant for a product without variants", () => {
    expect(hasValidSelectedVariant({ name: "Simple Product" }, products)).toBe(true);
  });

  it("returns only usable catalog variants", () => {
    expect(getProductVariants([
      { name: "Product", variants: [{ name: "Large" }, {}, { sku: "SMALL" }] },
    ], "Product")).toEqual([{ name: "Large" }, { sku: "SMALL" }]);
  });
});
