
-- Enable extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Add sync settings
INSERT INTO public.app_settings (key, value)
VALUES ('orio_sync_interval_minutes', '5')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('orio_last_status_sync', '')
ON CONFLICT (key) DO NOTHING;
