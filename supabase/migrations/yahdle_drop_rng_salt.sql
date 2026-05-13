-- Yahdle — drop orphaned yahdle_games.rng_salt column.
--
-- Background: rng_salt was scaffolded in yahdle_multiplayer_schema.sql
-- with the intent of someday powering a deterministic multiplayer RNG
-- (replay mode, tournament/spectator parity, anti-cheat verification).
-- That feature never shipped. yahdle_roll_one_die() uses live random()
-- and the solo daily uses its own date-seeded mulberry32 — nothing in
-- the system ever reads rng_salt.
--
-- Pre-drop audit (2026-05-13):
--   - Single source reference: yahdle_multiplayer_schema.sql:35
--   - No grep hits in yahdle/, rae-side-quest/, snibble/, wordy/, rungles/
--   - pg_depend: only the column's own default depends on it
--   - No functions, views, or triggers reference rng_salt
--   - No frontend types/code references rng_salt
--
-- Safe to drop. If we ever build deterministic MP RNG features, we can
-- re-add a salt column (or per-turn nonces) when the feature ships.

alter table public.yahdle_games drop column if exists rng_salt;
