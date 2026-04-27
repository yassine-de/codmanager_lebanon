---
name: WhatsApp AI finalize after address
description: AI must NOT ask "Shall we ship your order?" after the address is confirmed — it should finalize immediately.
type: feature
---

After the customer confirms their delivery address (YES / haan / sahi / ok / ✅, or by giving a new address), the WhatsApp AI must **NOT** send a second confirmation question like "Shall we ship your order? ✅".

Instead it sends ONE short closing message that:
1. Thanks the customer
2. Confirms the order will be shipped
3. Asks them to keep their phone available — the courier will call when arriving at the address

Examples:
- English: "Thank you 🙏 Your order is confirmed and will be shipped. Please keep your phone available — the courier will call you when he reaches your address 📦📞"
- Urdu / Roman Urdu: "Shukriya 🙏 Aap ka order confirm ho gaya hai, ship kar diya jayega. Phone available rakhein — courier address par pohanch kar aap ko call karega 📦📞"

Why: an extra "Shall we ship?" round-trip after the address is already confirmed loses customers and confuses them. The address confirmation is the implicit ship confirmation in COD.

Source of truth: `STEP 3 — ORDER CONFIRMATION (FINALIZE IMMEDIATELY)` block of the system prompt stored in `whatsapp_ai_settings.system_prompt`.
