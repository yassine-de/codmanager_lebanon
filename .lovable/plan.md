

# Fix: Shipping Reversal Adjustment Should Be Positive

## Problem
When an order reverts from `shipped` → `pending` on a closed invoice, the adjustment trigger creates a **negative** `shipping_difference`. This is wrong — the seller already **paid** the shipping fee in the closed invoice (it was deducted from their payout). Reversing it should **refund** the fee, meaning `shipping_difference` should be **positive**.

## Root Cause
In `create_invoice_adjustment_on_status_change`:
```sql
v_shipping_diff := -v_prev_shipping;  -- e.g. -3.00
```
Since `adjustment_net` is **added** to `net_payable`, a negative value here deducts even more from the seller instead of refunding the already-charged fee.

## Fix
Change the sign in the trigger — one line:
```sql
v_shipping_diff := +v_prev_shipping;  -- e.g. +3.00 (refund)
```
Also update the adjustment insert to store `previous_shipping_fee` and `new_shipping_fee` correctly:
- `previous_shipping_fee = v_prev_shipping` (what was charged)
- `new_shipping_fee = 0` (no longer shipped)
- `shipping_difference = +v_prev_shipping` (refund)

### Database Migration
Replace `v_shipping_diff := -v_prev_shipping` with `v_shipping_diff := v_prev_shipping` in the shipping reversal block of `create_invoice_adjustment_on_status_change`.

### No Frontend Changes
The Adjustments page already displays the sign correctly (+ green / - red).

## Result
- Shipped → pending on closed invoice: adjustment shows **+$X.XX** shipping refund
- Net payable in next invoice increases by that amount (seller gets money back)

