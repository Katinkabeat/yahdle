-- ============================================================
-- Yahdle — lock down legacy yahdle_record_matchup (side-find from c332)
--
-- yahdle_record_matchup(uuid, uuid, uuid, boolean) is the legacy 2-player
-- tally helper. It's SECURITY DEFINER and was executable by anon +
-- authenticated (via PUBLIC and explicit grants), so any logged-in user
-- could call it with arbitrary player ids and inflate/deflate win-loss
-- tallies in yahdle_matchups.
--
-- Nothing live calls it (checked 2026-09-24): no public function's prosrc
-- references it, no cron job or trigger, and no client/hub/Rook code in any
-- SQ repo. yahdle_finalize_game writes matchups itself; forfeit/claim route
-- through finalize.
--
-- REVOKE rather than DROP so it stays resolvable if an old migration file
-- is ever re-run. postgres + service_role keep EXECUTE.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.yahdle_record_matchup(uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
