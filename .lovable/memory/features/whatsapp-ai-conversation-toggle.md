---
name: whatsapp-ai-conversation-toggle
description: Per-conversation AI On/Off toggle in WhatsApp Inbox header, gates webhook AI auto-replies
type: feature
---
Each WhatsApp conversation has a boolean `ai_enabled` (default `true`) on `whatsapp_conversations`.

UI: Inbox chat header shows a pill button (Bot/BotOff icon, "AI On"/"AI Off") next to the read-only status chips. Clicking it flips `ai_enabled` for the selected conversation.

Backend gate: `whatsapp-webhook` skips `aiContinueReply` when `conv.ai_enabled === false`. Manual replies, templates, and existing automation runs are NOT affected.
