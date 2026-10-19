export interface CatalogVariant {
  name?: string | null;
  sku?: string | null;
}

export interface CatalogProductWithVariants {
  name: string;
  variants?: CatalogVariant[] | null;
}

export interface SelectedOrderVariant {
  name: string;
  variantName?: string | null;
  variantSku?: string | null;
}

export function getProductVariants(
  products: CatalogProductWithVariants[],
  productName: string,
): CatalogVariant[] {
  const product = products.find((candidate) => candidate.name === productName);
  return Array.isArray(product?.variants)
    ? product.variants.filter((variant) => Boolean(variant?.name || variant?.sku))
    : [];
}

export function hasValidSelectedVariant(
  item: SelectedOrderVariant,
  products: CatalogProductWithVariants[],
): boolean {
  const variants = getProductVariants(products, item.name);
  if (variants.length === 0) return true;

  const selectedName = item.variantName?.trim().toLocaleLowerCase();
  const selectedSku = item.variantSku?.trim().toLocaleLowerCase();

  return variants.some((variant) => {
    const name = variant.name?.trim().toLocaleLowerCase();
    const sku = variant.sku?.trim().toLocaleLowerCase();
    return Boolean((selectedName && name === selectedName) || (selectedSku && sku === selectedSku));
  });
}
