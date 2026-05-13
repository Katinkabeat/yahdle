# Yahdle session memory

Per the SQ session memory convention, update this file at the end of every
Yahdle work session with: what changed, what's pending, and any gotchas.

## Game overview

Push-your-luck daily word-dice game

- Slug: `yahdle`
- Deploys to: https://katinkabeat.github.io/yahdle/
- Theme color: `#7c3aed`
- Background color: `#faf5ff`

## Session log

### 2026-05-13 — Removed admin reset button on solo daily

Daily mode is now open to non-admin players, so the admin-only "↻ Reset" button on `SoloGamePage` had to go — it would have let admins re-roll the daily until they got a leaderboard-topping score. Removed the button JSX, the `resetSalt`/`saltKey` state, and the `:${resetSalt}` suffix on `seedBase`. Seed is now plain `yahdle:daily:${gameId}` for everyone. Existing `yahdle:salt:*` localStorage entries from past resets are harmless and left as-is.

### 2026-05-12 — Stats page wired (today + my mp stats)

Replaced the placeholder `StatsPage.jsx` with a two-tab page (Today default, My Stats).

- **Today tab:** today's leaderboard at top (rank, username, score), your score callout, score-distribution histogram (8 buckets, your bucket highlighted amber), quick stats (players / average / high). Backed by new RPC `yahdle_daily_leaderboard(p_date date)` joining `yahdle_solo_results` to `profiles` for usernames.
- **My Stats tab:** strictly multiplayer (1v1, future-proofed for N-player by summing across `yahdle_matchups` rows). Shows games played, win rate (W–L–T), best score, average score, and a 2-col grid of category bests for all 12 categories (uses `CATEGORIES` from `lib/scoring.js`). Backed by new RPC `yahdle_my_mp_stats()` returning a single row.
- **Streak intentionally omitted** — already in lobby. **Calendar heatmap dropped** — Snibble doesn't have one. **Filled-categories visual on Today dropped** — `yahdle_solo_results` only stores final score, not breakdown.
- New migration: `supabase/migrations/yahdle_stats_rpcs.sql`. Both RPCs SECDEF + `revoke from public, grant to authenticated`. Bug found in development: bare column names `wins/losses/ties` collided with `RETURNS TABLE(...)` OUT params — fixed with table-alias `m.`.
- Verified RPCs against real prod data via psql (Dino: 3 MP games, 3-0-0, best 81, avg 70.0, 12 cat bests). UI not interactively verified — auth-gated, Rae to spot-check after deploy.
- Raeban card [c46] moved to Fledged.

### 2026-05-12 — MP blank-tile bug fix (race in client state sync)

Rae and Onyi both hit a bug in MP where rolling produced blank tiles. Onyi's rolls were consumed without faces appearing.

- **Server was fine** — verified live `pg_get_functiondef` for `yahdle_roll_one_die`; the May-9 2D-array fix was deployed and `yahdle_dice_faces()` returns 6×8 cleanly.
- **Real cause: client-side race** — `handleRoll`, `handleScore`, `confirmZero` in `MultiGamePage.jsx` bypassed `trackTurnMutation`, so they didn't bump `pendingTurnMutations` / `turnStateGen`. Combined with the realtime channel only watching `yahdle_games` + `yahdle_players` (not `yahdle_turn_state`), stale snapshots could overwrite real faces.
- **Fixes shipped (commit `703df3c`):**
  - Wrapped roll/score/zero in `trackTurnMutation`.
  - Added `yahdle_turn_state` realtime subscription on the game channel.
  - Server-side guard in `yahdle_roll_dice`: raise exception if any face is null after the loop, so the txn rolls back and `rolls_used` doesn't increment on a busted roll. Deployed via Management API.
  - Client-side guard in `multiplayerActions.rollDice`: throw on empty/all-null array.
- Verified locally: two consecutive rolls in active MP game returned real letters, counter advanced 0→1→2, no console/server errors.
- Raeban card [c49] moved to Fledged.

### 2026-05-09 — Solo daily streak

Mirrored Snibble's streak pattern.

- New table `public.yahdle_solo_results` (user_id, play_date, score, completed_at) with RLS — one row per user per Atlantic-time day. Migration: `supabase/migrations/yahdle_solo_streak.sql`. Applied via Management API.
- New `src/hooks/useStreak.js` — copy of Snibble's hook, walks dates backward in Atlantic time. Streak doesn't break until midnight Atlantic passes (today empty + yesterday empty → 0).
- `SoloGamePage` upserts a row when `isGameOver` flips true (sessionStorage guard prevents repeat upserts on state changes within the same session).
- Streak badge on `SoloPlayCard`: `🔥 N` top-right, hidden when streak = 0. Same `bg-wordy-200 text-wordy-700` treatment as Snibble's lobby pet card.
- Solo-only. MP work in parallel uses separate tables.

### 2026-05-08 — Scaffolded

- Created from `rae-side-quest/templates/sq-game-starter/`
- Pre-wired with sq-ui chrome, dual-header, Supabase auth bounce,
  theme-flash prevention, push-notification SW, GitHub Pages deploy.
- Pending follow-ups before launch:
  - Add to `rae-side-quest`'s `dev:all` script
  - Add to SQ hub landing page game grid + post-login allowlist
  - Wire into shared notification system
  - Update other games' theme-flash localStorage fallback to include `yahdle-theme`
  - Build the actual game (lobby cards, board, scoring)
  - `gh repo create` + push
