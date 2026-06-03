# Lebanon Interface Inventory

This document tracks external interfaces in the Pakistan codebase and the intended Lebanon status.
It intentionally does not contain API keys, tokens, passwords, or connection strings.

## Current Decision

Lebanon starts as a clean system using the Pakistan application and database structure.
Pakistan-specific integrations must be disabled unless they are explicitly approved for Lebanon.

Feature flags live in `src/config/features.ts`.

## Interface Status

| Interface | Lebanon status | Notes |
| --- | --- | --- |
| Supabase Auth | Enabled | Required for login, roles, and admin access. |
| Supabase Database | Enabled | Lebanon database uses the Pakistan schema on a clean Supabase project. |
| Supabase Edge Functions | Limited | Keep only functions required by enabled features. Disable or ignore Pakistan-specific functions. |
| ORIO Sync | Disabled | Removed ORIO DB keys, disabled ORIO DB triggers, and hid ORIO configuration UI. Replace later with Wakilni Sync. |
| Wakilni Sync | Planned | Future replacement for ORIO. API credentials should only be stored as server-side Edge Function secrets. |
| Wakilni Areas | In progress | `wakilni-areas-sync` can cache `/api/v2/areas` into `wakilni_areas_cache`; city dropdown uses this cache with local Lebanon list fallback. |
| WhatsApp | Disabled | UI/routes disabled for initial Lebanon launch. |
| WhatsApp AI | Disabled | Depends on WhatsApp and AI provider configuration; not needed at launch. |
| WhatsApp Campaigns | Disabled | Not needed at launch. |
| Follow Ups | Disabled | Routes/sidebar disabled for initial launch. |
| Agent Assignment | Disabled | Routes/sidebar disabled for initial launch. |
| Freight Forwarder | Disabled | Not needed at launch. |
| Google Sheets Import | Review | Useful if Lebanon sellers import orders by spreadsheet. Keep only if the workflow is needed. |
| Product Context / Scraping | Review | Uses external fetching/enrichment. Disable unless product enrichment is needed. |
| Support / Alerts | Review | Currently not part of the initial disabled list, but should be checked for external dependencies before production. |

## Known ORIO Touchpoints

ORIO is disabled for Lebanon, but related code still exists in the copied Pakistan codebase.
Before production, these touchpoints should either be fully removed or kept behind `features.orioSync`.

| Area | Location | Action |
| --- | --- | --- |
| Edge function | `supabase/functions/orio-sync/index.ts` | Keep disabled; later replace with Wakilni sync implementation. |
| Edge function | `supabase/functions/orio-status-sync/index.ts` | Keep disabled; later map Wakilni statuses. |
| Edge function | `supabase/functions/orio-sync-retry/index.ts` | Keep disabled; later decide retry behavior for Wakilni. |
| UI | `src/pages/Integrations.tsx` | ORIO config is hidden when `features.orioSync` is false. |
| UI | `src/components/OrioTrackingModal.tsx` | Should not be reachable while ORIO is disabled. |
| UI | `src/components/FailedSyncModal.tsx` | Should not call ORIO while ORIO is disabled. |
| Hook | `src/hooks/useOrioCities.ts` | Replace with Lebanon city data or Wakilni city lookup. |
| Orders | `src/pages/Orders.tsx` and order detail views | Remove or rename ORIO labels before Lebanon production. |
| Dashboard/status | Dashboard and system status components | Hide ORIO status widgets while disabled. |

## Known WhatsApp Touchpoints

WhatsApp features are disabled for the initial Lebanon launch.
Before production, these should stay hidden and should not have active secrets configured.

| Area | Typical location | Action |
| --- | --- | --- |
| Webhook/function | `supabase/functions/*whatsapp*` | Do not configure webhook or secrets while disabled. |
| UI routes | WhatsApp pages and campaign pages | Hidden by feature flags. |
| Product modal | `src/components/CreateProductModal.tsx` | WhatsApp confirmation option is hidden when WhatsApp is disabled. |

## Launch-Safe Integration Rules

1. Do not add Pakistan production API keys to Lebanon.
2. Keep ORIO settings empty and ORIO triggers disabled until Wakilni is implemented.
3. Keep disabled features hidden in routes, sidebar, and action buttons.
4. Any external function should check feature flags or missing configuration before making network calls.
5. Before production, run a scan for provider names and API endpoints:

```powershell
rg -n -i "orio|whatsapp|openai|firecrawl|google|wakilni|api_key|token|secret|webhook" src supabase --glob "!node_modules/**" --glob "!dist/**"
```

## Next Implementation Steps

1. Remove Lebanon-visible Pakistan wording: app title, dashboard labels, currency labels, and ORIO copy.
2. Hard-disable remaining ORIO entry points so no component can invoke ORIO functions.
3. Decide whether Google Sheets import stays for the Lebanon launch.
4. Define the Wakilni integration contract:
   - create shipment
   - cancel shipment
   - retrieve shipment status
   - status webhook, if available
   - COD amount and currency handling
5. Add a Lebanon environment checklist for production secrets.
