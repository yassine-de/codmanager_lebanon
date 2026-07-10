INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('wakilni_invoice_auto_process_schedule', 'Saturday 16:00 Beirut time', now()),
  ('wakilni_invoice_auto_process_cron_utc', '0 13 * * 6', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wakilni-invoice-auto-process') THEN
    PERFORM cron.unschedule('wakilni-invoice-auto-process');
  END IF;

  PERFORM cron.schedule(
    'wakilni-invoice-auto-process',
    '0 13 * * 6',
    $cron$
    SELECT net.http_post(
      url := 'https://hpinbuajpewnkieiokmq.supabase.co/functions/v1/wakilni-invoice-drive',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaW5idWFqcGV3bmtpZWlva21xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzOTk1NTIsImV4cCI6MjA5NTk3NTU1Mn0.8PNB2CxjaQat7eurbVIzSrkngwzkeJ_G8dteOBoevck',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaW5idWFqcGV3bmtpZWlva21xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzOTk1NTIsImV4cCI6MjA5NTk3NTU1Mn0.8PNB2CxjaQat7eurbVIzSrkngwzkeJ_G8dteOBoevck'
      ),
      body := jsonb_build_object('action', 'process-latest', 'source', 'cron')
    );
    $cron$
  );
END $$;
