## Cause (root cause confirmed)

L-bug f cron job `tickPendingIntentHandoff` dyal `whatsapp-automation-runner` (kayrun kol daqiqa).

Had l-job kayqelleb 3la conversations WhatsApp li ba9i fihom `pending_button_intent` qadim (>60 min) o kaydir handoff l agent — kaybadel `confirmation_status -> 'new'`. Lakin kan **ma kayfiltrich** orders li déjà treaté: confirmed, booked, shipped, cancelled, no_answer, wrong_number…

Recently zedna guard (`protectedStatuses`), walakin **kabel ma t-deploya** (qbel 09:24 dyal 01/05), wahd run wahed dar handoff l 170 order, mn binathom **107 ka deja confirmed** o ba3d minhom kano `booked/shipped` (ORIO synced).

### Summary dyal lli rja3 `new` o ba9i corrupted daba:

| 7ala asliya | 3dad orders ba9yin corrupted |
|---|---|
| confirmed | 63 |
| no_answer | 23 |
| cancelled | 16 |
| wrong_number | 5 |
| **Total** | **107** |

Mn dakshi: **dezzin** dyal orders 3endhom `delivery_status = booked/shipped` walakin `confirmation_status = new` — system-incoherent.

---

## Plan dyal l-fix

### 1. Hardning code (final fix)
F `supabase/functions/whatsapp-automation-runner/index.ts` (function `tickPendingIntentHandoff`):

- Reverse the logic: instead of a small "protected" list, allow handoff **only** if `confirmation_status IN ('new_wts','pending_address')`. Ay status akhor → just clear l `pending_button_intent` mn conversation o skip order.
- Zid guard f update DB itself: `.in('confirmation_status', ['new_wts','pending_address'])` bash hatta race condition mat3awedch had l-bug.
- Improve logs bash kol skip y-bayyen old status.

### 2. Repair dyal 107 orders corrupted (data migration)

L kol order f had l-list, restore `confirmation_status` mn `order_history.old_value` dyal akher `whatsapp_auto_handoff`:

- **63 orders → confirmed**: restore `confirmation_status='confirmed'`, `confirmation_channel='whatsapp'`, `whatsapp_status='confirmed'`. Khalli `delivery_status`, `orio_*`, `confirmed_at` kima homa.
- **23 → no_answer**: restore `confirmation_status='no_answer'` only. Khalli `original_agent_id` (hia mawjouda) bash y-claimah agent original.
- **16 → cancelled**: restore `confirmation_status='cancelled'`.
- **5 → wrong_number**: restore `confirmation_status='wrong_number'`.

Zid log f `order_history` action_type='auto_repair' bash audit y-bayyen rja3na ghalat dyal system.

### 3. Verification queries ba3d repair
- 0 orders f `delivery_status IN ('booked','shipped','delivered')` 3endhom `confirmation_status='new'` causée par handoff.
- LL-273, AB-682, AB-666, AB-500 etc. kollhom rj3o l-7alat-hom s-7i7a.

### 4. Memory update
N-update `mem://features/whatsapp-pending-intent-handoff` bash y-document l-allowlist (only `new_wts`/`pending_address`), o nzid description f index.

---

Wash n-execute had l-fix kamel (code hardening + data repair dyal 107 orders + verification)?