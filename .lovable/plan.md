

# ORIO Sync Recovery & Hardening

## Ziel
Diese 4 Orders korrekt nach ORIO syncen + die 3 Root Causes systemisch beheben, damit es nicht wieder passiert.

## Sofort-Reparatur (Daten)

**AB-150** — City-Korrektur
- DB-Update: `customer_city = 'Rawalakot'`, `orio_sync_status = 'pending'`, `orio_sync_error = null`
- Danach Auto-Retry via `sync-order` Edge Function

**AB-213** — Falscher Sync-Status zurücksetzen
- DB-Update: `orio_sync_status = 'pending'`, `orio_synced_at = null` (orio_order_id ist eh schon null)
- Auto-Retry via `sync-order`

**MA-065 & MA-130** — Manueller Sync-Trigger
- Direkt via `sync-order` Edge Function aufrufen (Stadt ist gültig)

## Systemische Fixes (Code)

### Fix 1: City-Matching robuster machen (`orio-sync/index.ts`)
Aktuell: `name.trim().toLowerCase() === cityName`
Neu: zusätzlich Whitespace-normalisiert vergleichen (`.replace(/\s+/g, '')`), damit `"Rawala Kot"` ↔ `"Rawalakot"` matched.
Optional: Fuzzy-Fallback (Levenshtein ≤ 1) für menschliche Tippfehler.

### Fix 2: "synced ohne order_id" verhindern (`orio-sync/index.ts`)
Im Erfolgs-Branch:
```typescript
if (!orioOrderId) {
  await supabase.from("orders").update({
    orio_sync_status: "failed",
    orio_sync_error: "ORIO returned 200 but no order_id in response",
  }).eq("id", order.id);
  throw new Error("ORIO response missing order_id");
}
```
Damit werden solche Orders korrekt als `failed` markiert und im "Failed Sync Modal" sichtbar zum Retry.

### Fix 3: Sync-Trigger-Lücke schließen
Untersuchen wo `delivery_status='booked'` gesetzt wird (Confirm-Action, Bulk-Action, ORIO-Status-Sync) und sicherstellen dass **überall** danach `orio-sync` aufgerufen wird. Plus: Cron-Job-Fallback alle 10 Min, der alle Orders mit `confirmation_status='confirmed' AND delivery_status='booked' AND orio_order_id IS NULL AND orio_sync_status IN ('pending','failed')` automatisch erneut versucht (max. 3 Versuche, dann hard-fail).

### Fix 4: System Status Panel Erweiterung
Die `pending`-Orders die älter als 1h sind sollten ebenfalls als Warnung angezeigt werden (nicht nur `failed`), damit "stuck pending" Orders wie MA-065/MA-130 sofort sichtbar sind.

## Reihenfolge
1. Daten-Fix für die 4 Orders (sofort, eine Migration mit DB-Updates + 4× sync-order Aufrufe)
2. Code-Fixes 1+2 in `orio-sync/index.ts` deployen
3. Cron-Fallback (Fix 3) als neue scheduled Edge Function
4. UI-Erweiterung System Status Panel (Fix 4)

