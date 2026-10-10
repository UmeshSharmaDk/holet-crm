-- Add encrypted-file references alongside legacy bytea images.
-- Existing photos and columns are preserved; no rename, drop, or bulk conversion.
BEGIN;
ALTER TABLE public.booking_guests
  ADD COLUMN IF NOT EXISTS front_id_key text,
  ADD COLUMN IF NOT EXISTS front_id_checksum text,
  ADD COLUMN IF NOT EXISTS front_id_size integer,
  ADD COLUMN IF NOT EXISTS back_id_key text,
  ADD COLUMN IF NOT EXISTS back_id_checksum text,
  ADD COLUMN IF NOT EXISTS back_id_size integer;
COMMIT;
