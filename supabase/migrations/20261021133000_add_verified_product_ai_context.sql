ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ai_context_manual text;

COMMENT ON COLUMN public.products.ai_context_manual IS
  'Admin-reviewed product knowledge that is preserved independently of automatic store-page scraping.';

UPDATE public.products
SET ai_context_manual = $context$
Product: DrMelaxin Calcium Volume Multi Balm / Wrinkle Core Stick.

Source note: The following are benefits and product claims presented on the QH Shop product page. Describe them as intended or claimed benefits, not guaranteed medical results. Results can vary by skin type and consistency of use.

What it is intended for:
- A portable facial skincare stick intended to moisturize and nourish the skin, improve the appearance of firmness and elasticity, and reduce the appearance of wrinkles and fine lines.
- The store page highlights use around the eyes, between the eyebrows, and around the mouth.
- The store page also claims it can improve radiance and softness and help reduce the appearance of puffiness and dark circles.

Highlighted ingredients and the store's stated roles:
- Retinol: supports skin-cell renewal and collagen production; intended to help with firmness and the appearance of wrinkles.
- Collagen: intended to improve skin elasticity and reduce the appearance of fine lines.
- Pearl extract: intended to brighten the skin and support a softer, more radiant appearance.
- Caffeine: intended to refresh the skin and reduce the appearance of puffiness and dark circles.

Format and use:
- Compact stick format, designed for clean and easy application and convenient use while travelling or away from home.
- The page says it is suitable for all skin types and free from parabens and harmful fragrances.
- The page does not provide a precise application frequency or dose. Do not invent one; tell the customer to follow the directions on the product packaging.

Current offers shown on the store page:
- 2 pieces for USD 29.99.
- 4 pieces for USD 44.99.
- Cash on delivery and free delivery are advertised on the page.
$context$
WHERE id = '68947826-da14-44d1-a894-322f3bff9d9d'
   OR product_url = 'https://lebanshop.youcan.store/pages/mlxn';
