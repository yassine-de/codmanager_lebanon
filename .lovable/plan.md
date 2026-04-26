## Mochkil

Seller **Anwar Bounasser** (`AB-INV-001`) ando **218 confirmed** f orders table, walakin l-invoice ka-y3awd ghir **216**. Naqsin: `AB-265` w `AB-266`.

## Sabab

L-RPC `get_invoice_summary` ka-y7sab confirmed orders **ghir mn `order_history`** (events bach period dyal l-invoice tkun saحiحa). Walakin:

1. **`whatsapp-action` edge function** (button "Confirm" mn l-Inbox) ka-y-update `confirmation_status='confirmed'` **bla ma y-écrire f `order_history`** ⇒ kayna 0 events.
2. **AI auto-confirm path** (f `whatsapp-webhook` ligne 1591-1638) ka-y-skipi l-écriture mli l-order kan déjà confirmed (`wasAlreadyConfirmed=true`), donc helper `logOrderHistory` ka-y-skipi `confirmation_status` field bحal ma kayn delta.

L-orders AB-265 / AB-266 dazo mn dak l-path → 0 history rows li `field_changed='confirmation_status' AND new_value='confirmed'` → ma t7sbouch f l-invoice.

## L-7all

### 1. `supabase/functions/whatsapp-action/index.ts`
Zid call l `logOrderHistory` (nfs l-helper li f `whatsapp-webhook`) bach kol button-confirm/more_info/cancel y-écrire delta f `order_history` b:
- `action_type: "whatsapp_confirm" | "whatsapp_more_info" | "whatsapp_cancel"`
- `role: "whatsapp"`
- `changed_by: SYSTEM_USER_ID` (`00000000-0000-0000-0000-000000000000`)

(Hada howa same code style li f `applyOutcome` dyal webhook — n-shareewh.)

### 2. `supabase/functions/whatsapp-webhook/index.ts` — AI auto-confirm
F `tryExtractAndConfirmAddress` (≈ line 1631), mli `wasAlreadyConfirmed=true` (button qbel address), `confirmUpdate` ma fihch `confirmation_status`. Nzid manually entry f `order_history` bach `confirmation_status: '' → 'confirmed'` y-tracka mn awwl marra (lqaddam, `applyOutcome` ka-y-écrire dik l-row, walakin ila kana via `whatsapp-action`, ma kanetch). 7all più s-saheel: ndmnu `whatsapp-action` y-loggi → mochkil dyal cas hadi yt-7l automatic.

### 3. SQL Migration — Backfill
Migration ghadi:
- T-detecti tous les orders fin `confirmation_status='confirmed'` w `confirmation_channel IN ('whatsapp','ai')` walakin **kaynach** row f `order_history` b `field_changed='confirmation_status' AND new_value='confirmed'`
- T-zid row f `order_history` b:
  - `created_at = COALESCE(orders.confirmed_at, orders.updated_at)`
  - `action_type='whatsapp_confirm_backfill'`
  - `changed_by_role='whatsapp'`
  - `changed_by='00000000-0000-0000-0000-000000000000'`
  - `field_changed='confirmation_status'`, `old_value='new'`, `new_value='confirmed'`

Hadi ghadi t-fixi AB-265, AB-266, w kol order khor f same situation cross all sellers.

### 4. Verification
B3d migration:
```sql
SELECT (get_invoice_summary('bd833d8c-d94a-4bbd-99c2-47f2e091cb8f'::uuid))->'counts';
```
Khass i-banet `confirmed_count: 218`.

## Files

- `supabase/functions/whatsapp-action/index.ts` — zid logging
- `supabase/functions/whatsapp-webhook/index.ts` — small fix f AI auto-confirm path
- `supabase/migrations/<new>.sql` — backfill historique
