-- ============================================================
-- Yahdle — drop legacy yahdle_record_matchup (card c380)
--
-- Follow-up to yahdle_revoke_record_matchup.sql. Rae OK'd removal
-- 2026-09-24 provided nothing breaks. Checked against live prod first:
-- no function body in any schema references it (exact strpos match),
-- no pg_depend dependents, no view/policy/cron references, and no caller
-- in any SQ repo (yahdle, hub, Rook, wordy, rungles, snibble, oublex,
-- edge functions). yahdle_finalize_game writes matchups itself.
--
-- Definition snapshot: supabase/snapshots/yahdle_record_matchup_2026-09-24.sql
-- ============================================================

DROP FUNCTION IF EXISTS public.yahdle_record_matchup(uuid, uuid, uuid, boolean);
