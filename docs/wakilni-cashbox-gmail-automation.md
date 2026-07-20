# Wakilni Cashbox Gmail Automation

This Google Apps Script saves Wakilni cashbox PDF attachments from Gmail into the Drive folder used by COD Lebanon.

Drive folder:

`1hpDtSIx3pzc7r5gm9LuSS28ALikhTBJr`

## Setup

1. Open [Google Apps Script](https://script.google.com/).
2. Create a new project named `Wakilni Cashbox to Drive`.
3. Paste the contents of `scripts/google-apps-script/wakilni-cashbox-gmail-to-drive.gs`.
4. Save the project.
5. Run `saveWakilniCashboxInvoicesToDrive` once and approve Gmail/Drive permissions.
6. Run `createWakilniCashboxTrigger` once.

## What It Does

- Searches Gmail for Wakilni Cashbox mails with PDF attachments.
- Skips mails already marked with `Wakilni/Cashbox-Saved`.
- Saves matching PDFs into the Wakilni invoice Drive folder.
- Renames files to `Wakilni_Cashbox_Statement_YYYY-MM-DD.pdf` when possible.
- Adds `Wakilni/Cashbox-Saved` after successful processing.
- Adds `Wakilni/Cashbox-Error` if a mail could not be processed.

## Schedule

The script creates two triggers:

- Daily at about 10:00
- Saturday at about 14:00

The Supabase invoice processor still runs separately on Saturday at 16:00 Beirut time, so the PDF should already be in Drive before processing.

## Manual Backfill

If an old Wakilni email was not saved to Drive, remove the `Wakilni/Cashbox-Saved` label from that thread if it exists, then run:

`saveWakilniCashboxInvoicesToDrive`

After the PDF appears in Drive, use the COD Lebanon Wakilni page to scan or process the latest invoice.
