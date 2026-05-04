-- Prevent duplicate automation runs for the same order + automation.
-- A partial unique index excludes "failed" rows so that failed runs can be
-- retried without hitting the constraint.
--
-- This is a DB-level safety net that works alongside the soft dedup check in
-- the whatsapp-automation-runner edge function. Even if two concurrent
-- invocations both pass the soft check before either inserts, only one INSERT
-- will succeed — the other will get a unique-violation error and be silently
-- skipped (the edge function already logs and continues on insert error).

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_automation_runs_dedup_idx
  ON public.whatsapp_automation_runs (automation_id, order_id)
  WHERE status <> 'failed';
