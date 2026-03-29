
UPDATE products p
SET landed_price = sr.seller_price
FROM sourcing_requests sr
WHERE p.sourcing_request_id = sr.id
  AND sr.seller_price IS NOT NULL
  AND sr.seller_price > 0;
