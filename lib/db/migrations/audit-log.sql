-- Additive reconciliation for the audit schema already declared in auditLog.ts.
-- No booking or identity-document columns are changed. Not a startup/deploy hook.
BEGIN;
CREATE TABLE IF NOT EXISTS public.audit_log (
  id serial PRIMARY KEY,
  actor_user_id integer,
  actor_email text NOT NULL,
  actor_role text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id integer,
  hotel_id integer,
  detail jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log (created_at);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON public.audit_log (target_type, target_id);
COMMIT;
