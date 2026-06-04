CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('wakilni_status_sync_interval_minutes', '30', now())
ON CONFLICT (key) DO UPDATE
SET value = '30',
    updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wakilni-status-sync') THEN
    PERFORM cron.unschedule('wakilni-status-sync');
  END IF;

  PERFORM cron.schedule(
    'wakilni-status-sync',
    '*/5 * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://hpinbuajpewnkieiokmq.supabase.co/functions/v1/wakilni-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInJlZiI6ImhwaW5idWFqcGV3bmtpZWlva21xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzOTk1NTIsImV4cCI6MjA5NTk3NTU1Mn0.8PNB2CxjaQat7eurbVIzSrkngwzkeJ_G8dteOBoevck'
      ),
      body := jsonb_build_object('action', 'sync-statuses', 'source', 'cron')
    );
    $cron$
  );
END $$;
