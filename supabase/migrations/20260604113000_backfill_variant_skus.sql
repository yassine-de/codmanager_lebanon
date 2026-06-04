-- Ensure every product variant carries its own SKU.
-- Existing variant data from sourcing sometimes only had name/quantity.
UPDATE public.products p
SET variants = fixed.variants,
    updated_at = now()
FROM (
  SELECT
    p.id,
    jsonb_agg(
      CASE
        WHEN COALESCE(NULLIF(v.elem->>'sku', ''), '') = '' THEN
          jsonb_set(
            v.elem,
            '{sku}',
            to_jsonb(
              p.sku || '-' ||
              COALESCE(
                NULLIF(
                  regexp_replace(
                    upper(COALESCE(v.elem->>'name', v.elem->>'group', 'VAR' || v.ord::text)),
                    '[^A-Z0-9]+',
                    '',
                    'g'
                  ),
                  ''
                ),
                'VAR' || v.ord::text
              )
            )
          )
        ELSE v.elem
      END
      ORDER BY v.ord
    ) AS variants
  FROM public.products p
  CROSS JOIN LATERAL jsonb_array_elements(p.variants) WITH ORDINALITY AS v(elem, ord)
  WHERE jsonb_typeof(p.variants) = 'array'
  GROUP BY p.id
) fixed
WHERE p.id = fixed.id
  AND p.variants IS DISTINCT FROM fixed.variants;
