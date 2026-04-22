---
name: WhatsApp Automation - New Order trigger scope
description: The 'new_order' automation trigger only fires for orders whose product has whatsapp_confirmation_enabled = true.
type: feature
---

The `new_order` trigger in WhatsApp Automations is **scoped to WhatsApp-enabled products only**.

**Rule:**
- Fires only when the order's product has `products.whatsapp_confirmation_enabled = true`.
- All other new orders (call-center / agent flow) are ignored by automations.

**How to enforce in any runner / edge function:**
Before executing automations of type `new_order`, look up the product:
```sql
SELECT whatsapp_confirmation_enabled
FROM products
WHERE seller_id = order.seller_id AND name = order.product_name
LIMIT 1;
```
Skip the automation if false/null.

**Related DB logic:** the `route_order_to_whatsapp` BEFORE INSERT trigger already routes such orders to `confirmation_status = 'new_wts'` and `confirmation_channel = 'whatsapp'`. Runners can also simply filter on `confirmation_channel = 'whatsapp'` as a shortcut.
