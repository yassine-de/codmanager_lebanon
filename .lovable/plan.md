# Address-Gated Order Confirmation

## Problem

Fach kayji new order, l-system kaysift template m3a buttons (YES / NO).
Melli l-customer kayclicki **YES**, l-order automatic kaywoli **confirmed** — hta ila l-address dyalo na9sa wla ghir "Karachi center" wla ghir l-city. Hadchi kaydir mochkil f tawsil l9a l-rider ma 3andoش wein imchi.

Bghina:
1. Melli customer iclicki YES → l-AI kayverifie l-address l9adim f order.
2. Ila l-address **kamla w mzyana** → confirme automatic (kif daba).
3. Ila l-address **na9sa / vague / ghir city / fake** → **MA tconfirmich**, sift WhatsApp message lil-customer (b lougha dyalo) tatlobou full address (house/street/area + landmark).
4. Melli customer kay-reply b address kamla → l-AI ydir auto-update l `customer_address` w `customer_city`, w 3ad confirme l-order.

## Plan

### 1. Force AI gating on every confirm-button (server-side safety net)

`supabase/functions/whatsapp-automation-runner/index.ts` → `applyButtonAction()`:
- Ila l-button `status === "confirmed"` w l-order ma 3ndoش address deliverable (n-checkiw b nafs `isDeliverable` helper li f webhook), **noverridiw** l-action: nstashiw `pending_button_intent = { intent: "confirm", button_text }`, n-set `ai_enabled = true`, `whatsapp_status = "pending_address"`, w **MA n-changeoش** `confirmation_status`. Hadchi kaydir kif `ai_gate=validate` automatic mn ghir maykhass admin yconfiguri walou.
- Ila address **already deliverable** → confirme normal (mafihaш delay).

`supabase/functions/whatsapp-webhook/index.ts` → `applyOutcome()`:
- Nfs logic: ila `outcome === "confirmed"` w address ma deliverable, n-skip update l `confirmation_status`, n-set `whatsapp_status = "pending_address"`, w n-set `pending_button_intent` 3la l-conversation bach AI tcontinui.

### 2. AI takes over to ask for the address

L-AI `aiContinueReply()` (`whatsapp-webhook/index.ts`) deja kaytعamel m3a `pending_button_intent.intent === "confirm"` w `addressIncomplete` — kayseft message kayrequesti l-address.

Ghadi nزidو:
- Tswab message kaybda b: "Shukria 🙏 order dyalk confirmed! Bach n-shippiw lik, 3afak عtina l-full delivery address (house/flat #, street, area, landmark + city)."
- Wakha l-status f DB ma3adش `confirmed`, l-customer ka-yhss bli l-confirmation t-9ablat — only address li khass.

### 3. Auto-confirm after customer sends full address

Logic deja kaykhdem f `tryExtractAndConfirmAddress()`:
- Kay-runi 3la kol customer text reply.
- Ila AI extracted complete address → kay-update `customer_address`, `customer_city`, w kay-set `confirmation_status = "confirmed"`, kay-clear `pending_button_intent`.
- Hna مa khassش tbdil — ghir n-confirmiw bli logic kaykhdem fhal blast li ma kanetش `confirmation_status` confirmed.

### 4. Inbox visibility

Nزidو badge sغir f WhatsApp Inbox conversation list:
- Ila `pending_button_intent?.intent === "confirm"` → tban "⏳ Awaiting address" badge tahta esm dyal customer.
- Hadi tكhli admins yshofو bsرعa f7al li customer clicka YES walakin baqi ka-yssناو address.

`src/pages/whatsapp/WhatsappInbox.tsx` → conversation list item render.

## Technical notes

- `isAddressDeliverable` helper deja exists f `aiContinueReply` — n-extractiw m module-level function bach `applyOutcome` w `applyButtonAction` ystaعmlوha.
- `pending_button_intent` column deja exists 3la `whatsapp_conversations`.
- `whatsapp_status` value `pending_address` jdida — ghir text flag, ma kat-affectiش schema.
- `tryExtractAndConfirmAddress` deja handles l-case dyal `wasAlreadyConfirmed === false` — kay-set confirmation_status. Maخassش tbdil.
- AI prompt block li f line ~1184 (ADDRESS COLLECTION) deja mzyana — ghir n-tweakiw l wording bach تbdaa b "Thanks for confirming! Now we just need your full address" wat l-pending_button_intent block (~1202) yقول l-AI explicitly: "MA tقولش 'order is being processed' hta address tkoun deliverable."

## Files to edit

- `supabase/functions/whatsapp-webhook/index.ts` — extract `isAddressDeliverable` to module scope; gate `applyOutcome` for confirm; tweak AI prompt wording for pending_address case.
- `supabase/functions/whatsapp-automation-runner/index.ts` — gate `applyButtonAction` confirm path the same way.
- `src/pages/whatsapp/WhatsappInbox.tsx` — show "⏳ Awaiting address" badge on conversations with `pending_button_intent.intent === "confirm"`.
