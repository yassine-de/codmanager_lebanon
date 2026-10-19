-- The inherited sweeper points to an old/non-Lebanon Supabase project.
-- Keep it disabled until a Lebanon-specific automation has been tested.
DO $$
DECLARE
  sweeper_job_id bigint;
BEGIN
  SELECT jobid
  INTO sweeper_job_id
  FROM cron.job
  WHERE jobname = 'whatsapp-ai-sweeper'
  LIMIT 1;

  IF sweeper_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(sweeper_job_id, active := false);
  END IF;
END $$;
