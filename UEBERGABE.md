# Übergabe – COD Lebanon

Stand: 19. Oktober 2026

## Repository

- Repository: `https://github.com/yassine-de/codmanager_lebanon.git`
- Arbeitsbranch: `main`
- Supabase-Projekt: `hpinbuajpewnkieiokmq`
- Produktionsdomain: `https://cod-service.com`

Diese Datei enthält bewusst keine Zugangsdaten, API-Keys oder Tokens.

## Aktueller WhatsApp-Stand

- WhatsApp-Integration: aktiviert
- Senden: aktiviert
- Empfangen/Webhook: aktiviert
- Ländercode: `961`
- Aktuell verifizierte WhatsApp-Nummer: `+961 79 451 180`
- Webhook-Handshake am 19.10.2026 erfolgreich (`HTTP 200`, Challenge korrekt)
- Automatische Wakilni-Buchung nach Bestätigung: deaktiviert

### Template

Das erste produktive Template ist erstellt und von Meta genehmigt:

- Anzeigename: `تأكيد طلب جديد`
- Meta-Name: `new_order_confirmation_lb_ar`
- Sprache: Arabisch (`ar`)
- Kategorie: `UTILITY`
- Meta Template ID: `2571467973264460`
- Status: `APPROVED`
- Aktiv: ja
- Buttons:
  - `نعم، تأكيد الطلب`
  - `معلومات إضافية`

Die frühere englische Testvorlage wurde entfernt. Das von Meta bereitgestellte
Template `hello_world` ist weiterhin vorhanden.

## AI-Konfiguration

Die Live-Einstellungen wurden für Lebanon konfiguriert:

- Modell: `gpt-4o-mini`
- Standardsprache: libanesisches Arabisch in arabischer Schrift
- Bei eindeutig englischen oder französischen Nachrichten wird in derselben Sprache geantwortet
- Währung: USD
- Ton: freundlich und kurz, normalerweise 1–3 Zeilen
- Temperature: `0.3`
- Max Tokens: `400`
- Spracherkennung: aktiviert
- Intent-Erkennung: aktiviert
- AI Memory: aktiviert
- Full Auto Reply: **deaktiviert**

Der OpenAI-Key ist als Supabase Edge Function Secret `OPENAI_API_KEY` hinterlegt.
Der Key selbst ist weder in Git noch in dieser Datei gespeichert.

### Lokalisierte AI-Logik

Die bisher aus Pakistan übernommene Logik wurde für Lebanon angepasst:

- `+961`-Telefonnummern statt `+92`
- USD statt PKR
- Arabisch/Englisch/Französisch statt Urdu/Roman Urdu
- libanesische Adressstruktur und arabische Adressbegriffe
- Abgleich mit `wakilni_areas_cache` statt `orio_cities_cache`
- keine erfundene Zusage zum Öffnen eines Pakets vor Bezahlung
- unklare Versand-, Garantie-, Rückgabe- und Paketregeln werden an einen Menschen übergeben
- libanesische Bestätigungs- und Stornierungsformulierungen werden erkannt

## Live deployte Edge Functions

Am 19.10.2026 deployt und anschließend als `ACTIVE` geprüft:

- `whatsapp-ai`, Version 4, JWT-Prüfung aktiviert
- `whatsapp-webhook`, Version 6, JWT-Prüfung deaktiviert (für Meta-Webhook erforderlich)

## Verhalten bei einem Button-Klick

### `نعم، تأكيد الطلب`

- Bei vorhandener, zustellbarer Adresse wird die Bestellung direkt bestätigt.
- Bei fehlender oder zu ungenauer Adresse wird die Bestätigung zunächst zurückgehalten.
- Die AI fragt nach Stadt/Ort oder Gebiet plus einem brauchbaren Adressmerkmal,
  zum Beispiel Straße, Gebäude, Etage, Geschäft/Büro oder Landmarke.
- Nach einer vollständigen Adresse bestätigt das System die Bestellung.
- Wakilni wird derzeit nicht automatisch gebucht.

### `معلومات إضافية`

- Die Unterhaltung bleibt offen und wird einem Mitarbeiter zur Bearbeitung übergeben.

## Noch nicht erledigt

1. Es existiert aktuell **keine WhatsApp-Automation** in der Tabelle
   `whatsapp_automations`.
2. Deshalb wird das genehmigte Template noch nicht automatisch bei neuen
   Bestellungen versendet.
3. Full Auto Reply bleibt bis zum kontrollierten Test deaktiviert.
4. Es wurde noch keine echte Kundennachricht als End-to-End-Test versendet.
5. Danach muss entschieden werden, ob bestätigte Bestellungen automatisch an
   Wakilni gebucht werden sollen. Aktuell ist das ausgeschaltet.

## Datenbankbereinigung vom 19.10.2026

- Ursache der überschrittenen Free-Plan-Datenbankgröße war hauptsächlich
  `cron.job_run_details`, nicht die Bestellungsdaten.
- `whatsapp-ai-sweeper` war aus dem Pakistan/Altprojekt übernommen und zeigte
  auf das falsche Supabase-Projekt `gxyxmxzphyepsmecwbfi`.
- Der Sweeper wurde pausiert und bleibt bis zu einem kontrollierten Lebanon-Test
  deaktiviert.
- Seine 199.651 historischen Ausführungen wurden nach erfolgreicher Sicherung
  gelöscht; andere Cron-Historien blieben erhalten.
- Nach `VACUUM FULL` sank die Datenbankgröße von ungefähr 563 MB auf 286 MB.
- Die vollständige Cron-Historie vor der Löschung liegt nur lokal unter:
  `D:\CODEX\CODSERVICE\backups\codlebanon\2026-10-19`
- Das Backup enthält 629.721 Datensätze, Manifest, SHA-256-Prüfsumme,
  Wiederherstellungsanleitung und Restore-Skript. Es kann Cron-Befehle enthalten
  und darf deshalb nicht nach GitHub oder in einen ungeschützten Cloud-Share.
- Für die Weiterarbeit auf einem anderen Rechner muss dieses Backup bei Bedarf
  separat und sicher übertragen werden; es ist absichtlich nicht Teil des Repos.

## Bestellvalidierungen vom 19.10.2026

### Variantenpflicht bei Bestätigung

- Wenn ein Produkt Varianten besitzt, kann ein Agent die Bestellung erst auf
  `Confirmed` setzen, nachdem eine gültige Variante ausgewählt wurde.
- Die Prüfung greift sowohl bei der normalen Agent-Bearbeitung als auch bei der
  nachträglichen Bearbeitung unter `Treated Orders`.
- Zusätzlich schützt die Datenbank den Agent-RPC gegen eine Bestätigung ohne
  erforderliche Variante.
- Migration: `20261019193000_require_agent_variant_before_confirmation.sql`
- Commit: `3be494b Require variants before agent confirmation`

### Pflichtgrund bei Stornierungen

Bei einer neuen Umstellung auf `Cancelled` muss jetzt ein Grund ausgewählt
werden. Das gilt für:

- die normale Agent-Bearbeitung
- die nachträgliche Bearbeitung unter `Treated Orders`
- das allgemeine `Edit Order`-Fenster für Administratoren

Verfügbare Gründe:

- `High Price`
- `Product Issue`
- `Not Convinced`
- `Quality Issue`
- `Other`

Bei `Other` ist das Notizfeld verpflichtend; der eingegebene Text wird als
konkreter `cancel_reason` gespeichert. Änderungen am Status und am Grund werden
in `order_history` protokolliert.

Die Datenbank lehnt neue Wechsel auf `Cancelled` ohne `cancel_reason` ab. Bereits
vorhandene alte Stornierungen ohne Grund werden nicht nachträglich verändert und
können weiterhin in Auswertungen als `Not specified` erscheinen.

- Migration: `20261019194500_require_cancel_reason.sql`
- Commit: `f103720 Require cancellation reasons across order flows`
- Migration ist in der Live-Datenbank angewendet und in der Supabase-
  Migrationshistorie als `applied` registriert.
- Die veröffentlichte Produktion wurde auf das neue Dropdown geprüft.

Während der Veröffentlichung war die Datenbankregel kurz vor der neuen
Oberfläche aktiv. Dadurch wurden Stornierungen aus der alten `Treated Orders`-
Oberfläche blockiert. Die Regel wurde vorübergehend entfernt, zuerst die neue
Oberfläche veröffentlicht und danach erneut aktiviert. Der Endstand ist geprüft;
bei dieser Korrektur wurden keine Bestellungen verändert.

## Empfohlener nächster Schritt

Eine einzige Automation `New Order Confirmation Lebanon` erstellen:

1. Trigger: neue Bestellung für den WhatsApp-Bestätigungskanal
2. Template senden: `new_order_confirmation_lb_ar`
3. Auf Button oder Kundenantwort warten
4. AI nur für Rückfragen bzw. eine fehlende/unvollständige Adresse übernehmen lassen
5. Zunächst mit genau einer internen Testbestellung testen
6. Erst nach erfolgreichem Test Full Auto Reply oder Wakilni-Autobuchung aktivieren

## Einrichtung auf einem anderen Rechner

```powershell
git clone https://github.com/yassine-de/codmanager_lebanon.git
cd codmanager_lebanon
npm install
```

Danach `.env.local` lokal anlegen oder über einen sicheren Passwortmanager
übertragen. Benötigte Variablennamen:

```dotenv
VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ACCESS_TOKEN=
OPENAI_API_KEY=
```

`SUPABASE_SECRET_KEY` für das Pakistan-Vergleichsprojekt ist nur erforderlich,
wenn erneut Daten aus `codmanager-paki-compare` gelesen werden sollen. Secrets
niemals committen oder in Chats kopieren.

## Verifikation

Vor der Übergabe ausgeführt:

- OpenAI-Zugang geprüft: erfolgreich (`HTTP 200`)
- Supabase Edge-Function-Zugriff geprüft: erfolgreich
- Supabase Function Secret gesetzt: erfolgreich
- beide WhatsApp-Funktionen deployt: erfolgreich
- Webhook-Handshake: erfolgreich
- Meta-Template-Synchronisierung: erfolgreich, Template `APPROVED`
- `npm test`: 3 Testdateien / 9 Tests erfolgreich
- `npm run build`: erfolgreich
- Produktionsbundle enthält die neue Stornierungsgrund-Oberfläche: erfolgreich
- Datenbanktrigger `require_cancel_reason_on_orders`: aktiv
- Datenbankregel mit temporärer Testtabelle geprüft: grundlose Stornierung
  abgelehnt, Stornierung mit Grund akzeptiert; Testtransaktion zurückgerollt
- Syntax-Bundling beider geänderter Edge Functions: erfolgreich
- `git diff --check`: erfolgreich

`npm run lint` ist repositoryweit nicht grün (706 bereits vorhandene Fehler,
überwiegend `no-explicit-any` und `@ts-nocheck`). Das ist kein durch diese
WhatsApp-Änderung neu eingeführter Befund.

## Wichtige Dateien

- `supabase/functions/whatsapp-ai/index.ts`
- `supabase/functions/whatsapp-webhook/index.ts`
- `supabase/functions/whatsapp-automation-runner/index.ts`
- `supabase/migrations/20261019120000_localize_whatsapp_ai_for_lebanon.sql`
- `src/pages/whatsapp/WhatsappAutomations.tsx`
- `src/pages/whatsapp/WhatsappAutomationBuilder.tsx`
- `src/pages/AgentOrders.tsx`
- `src/pages/AgentConfirmedOrders.tsx`
- `src/components/EditOrderModal.tsx`
- `src/lib/cancellationReasons.ts`
- `src/lib/productVariants.ts`
- `supabase/migrations/20261019193000_require_agent_variant_before_confirmation.sql`
- `supabase/migrations/20261019194500_require_cancel_reason.sql`

Hinweis zur Migration: Die AI-Einstellungen wurden bereits direkt in der
Live-Datenbank aktualisiert. Die neue Migration hält denselben Sollzustand im
Repository fest und ist idempotent, wurde aber nicht über die Supabase-
Migrationshistorie als ausgeführt registriert.
