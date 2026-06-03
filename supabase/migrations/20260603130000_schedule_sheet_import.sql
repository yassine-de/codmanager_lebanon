CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('sheet_import_interval_minutes', '5', now())
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'import-google-sheets') THEN
    PERFORM cron.unschedule('import-google-sheets');
  END IF;

  PERFORM cron.schedule(
    'import-google-sheets',
    '* * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://hpinbuajpewnkieiokmq.supabase.co/functions/v1/import-sheets',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaW5idWFqcGV3bmtpZWlva21xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzOTk1NTIsImV4cCI6MjA5NTk3NTU1Mn0.8PNB2CxjaQat7eurbVIzSrkngwzkeJ_G8dteOBoevck'
      ),
      body := jsonb_build_object('source', 'cron')
    );
    $cron$
  );
END $$;
