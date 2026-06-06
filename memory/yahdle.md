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

### 2026-06-06 — single-rematch accept handshake (c165) SHIPPED

Replaced the unilateral rematch (both players could each fire `yahdle_rematch`, spawning two parallel games) with a one-open-request-per-game accept/decline handshake. **1v1 only**; N-player finished games (not creatable via the current lobby UI) keep the legacy unilateral `yahdle_rematch`. Built + deployed + verified at the DB layer and via a throwaway render harness; the live two-session click/flip can't be E2E'd headlessly (auth gate) so it's unverified live, but render + all RPC branches are.

- **Migration `yahdle_rematch_handshake.sql`** (applied to prod via pooler psql): adds `yahdle_games.rematch_requested_by` + `rematch_new_game_id`. Three SECDEF RPCs:
  - `yahdle_request_rematch` — `select … for update` row lock makes "first click wins" resolve server-side; rejects a second different requester ("opponent already requested"). Guards finished + 2-player + participant + not-already-accepted.
  - `yahdle_accept_rematch` — the OTHER player only; inserts the fresh game **already `active`** (both seats + 2 turn_states + new coin flip, requester = creator seat 0), back-links `rematch_new_game_id` onto the finished game, returns the new id. Idempotent on double-accept. **No second invite/accept step.**
  - `yahdle_decline_rematch` — either participant clears the slot; **no notification** (Rae's call). Blocked once accepted.
- **Push:** reuses the **invite** pref bucket. Tightened the `on_yahdle_game_invited` trigger to fire only when `NEW.status='waiting'` — so the active rematch insert doesn't ping a stale "you're invited" to the requester. New edge-fn type `rematch_requested` (client fire-and-forget POST from `requestRematch`, mirrors `sendNudge`): looks up requester + the other participant, pushes "X wants a rematch!" to the recipient, tap target = the finished game (where Accept/Decline lives).
- **Client:** `multiplayerActions.js` — new `requestRematch`/`acceptRematch`/`declineRematch` (kept legacy `rematch` for the N-player fallback). `GameOverComparison.jsx` — new `RematchControls` renders 3 states (Rematch → "requested ⏳ / Cancel" → opponent's "Accept/Decline"); falls back to the single legacy button when `max_players > 2`. `MultiGamePage.jsx` — handlers + a one-shot effect that auto-navigates the **requester** into the new game when `rematch_new_game_id` appears via realtime (the accepter navigates directly from the accept handler).
- **Verified:** migration clean; edge fn deployed; full handshake simulated against a real finished 1v1 game in a rolled-back txn (impersonating both players via `request.jwt.claims`) — all branches green; client builds clean; all 3 UI states render correctly (temp `/multi-rematch-preview` bypass route, snapshotted, then reverted). SW `CACHE_VERSION` → `yahdle-v3`.
- Commit `9b9852d`.

### 2026-06-06 (later) — faster turn refresh on push (c180)

Rae noticed during c165 testing: with a game already open, the turn-change push arrives but the page lags before flipping to "your turn" — the realtime socket is throttled while the tab is backgrounded, so it waits on the 15s poll / a refocus. Fix: `sw.js` push handler now `postMessage({type:'REFRESH'})` to every open Yahdle client; `main.jsx` relays as a `sq:push-refresh` window event; `MultiGamePage` listens → `refresh()`. The push is the fastest signal we already have, so the open page wakes instantly. **No extra Supabase load** (same refresh the poll would do, just sooner). SW `CACHE_VERSION` → `yahdle-v4`. Commit `3de6e9a`.

- **Known latent (not fixed):** `yahdle_players` has replica identity `default(pk)` but its realtime sub filters by `game_id` (non-PK) → live opponent score-pill updates may not deliver reliably; set `replica identity full` if that lag is ever felt.

### 2026-05-29 — N-player regressions fixed (c149) + smarter invite expiry (c150)

Two post-ship regressions from the c136 N-player work, then a redesign of invite expiry. All shipped + verified at the data layer (live multi-account MP can't be E2E'd headlessly).

- **c149 — rematch RPC broken:** `yahdle_rematch` called `yahdle_create_game(v_opponent)` (single uuid), but the N-player migration DROPPED that overload for `yahdle_create_game(uuid[], int)` → "function yahdle_create_game(uuid) does not exist". Rewrote rematch N-player-aware (`yahdle_nplayer_rematch_fix.sql`): gather all other participants, `yahdle_create_game(others[], n)`, caller seated as creator. Verified by simulating a rematch in a rolled-back txn.
- **c149 — game vanishes from lobby after you join:** `useMultiplayerLobby` main query filtered only `created_by/invited_user_id/invited_user_ids`. Joining an OPEN game makes you none of those (join sets the legacy `invited_user_id` to the FIRST joiner, not you), so the row never came back at all (the `amPlayer` bucketing fix from c136 was necessary but the row never reached `list`). Fixed: also fetch the `game_id`s I'm seated in (`yahdle_players` where user_id=me) and merge+dedupe. Confirmed on real prod data (old `.or()`→0 rows, seated query→returns it). Also recovers active open-join games dropped the same way.
- **c150 — smarter invite expiry (replaces silent hard-delete):** `yahdle_invite_expiry_v2.sql`.
  - Friend-invite window **1 day → 3 days** (open stays 7).
  - `yahdle_expire_stale_invites()` no longer blanket-DELETEs. Per expired waiting game: **≥2 joined** → drop no-show slots, shrink `max_players` to who's here, START short-handed; **only the creator** → CLOSE (`status='finished'` + new `closed_reason='no_other_players'`, winner null, **skips `yahdle_finalize_game`** so no matchups/stats). `invited_user_ids` kept for pills.
  - Suppressed the "opponent joined" push on short-handed auto-start via txn-local GUC `yahdle.suppress_join_push` (checked in `yahdle_notify_opponent_joined`). The waiting→finished close path never trips the active→finished `game_finished` trigger.
  - Edge fn: new `game_closed` type → one push to the lone creator (via the `game_finished` pref bucket). Only push in this flow.
  - Client: closed games render in Completed as "🚫 Game closed" + blurb (`LobbyPage.jsx`); no-show invitees render as greyed ✗ pills — no score, not tappable, **Option C** style (matches forfeited pill minus strike-through), ✗ glyph (`MultiGamePage.jsx` `PlayerPill`, gated to non-waiting). Mockup `docs/c150-noshow-pills-mockup.html`.
  - Decisions (Rae-approved): min playable = 2; notify only on close; closed-no-show never counts toward stats; blurb option C; pill style C + ✗.
- **Carried forward (parked, await Rae's approval):** c151 — make this expiry policy the baseline across all SQ MP games (audit Wordy/Rungles/Snibble first); c152 — bake it into sq-game-starter; c153 — Wordy "claim inactive win" hidden on mobile.
- Commits: `2fb19da` (c149), `db92adb` + `4d2898f` (c150).

### 2026-05-27 (later) — N-player multiplayer SHIPPED (c136) + forfeit-continue + c142 fledged

Lifted Yahdle MP from 1v1 → **2–4 players** by porting Wordy's pattern. Built, deployed to prod, verified at the data layer (11 local Postgres sims across the two migrations). **PENDING: live 3–4 account playthrough — can't be headless.**

- **Migrations (applied to prod via pooler psql):**
  - `yahdle_nplayer_engine.sql` — adds `yahdle_games.max_players` (2–4) + `invited_user_ids uuid[]`; relaxes the `current_player_idx`/`player_index` CHECKs; modulo turn rotation `(idx+1)%n`; auto-start when seats fill; **top-score-group-wins** finalize (1v1 tie → BOTH win; `ties` retired); pairwise `yahdle_matchups` (like Wordy); adds `yahdle_is_participant()` + N-player RLS read policies (without them players 3–4 can't read their own game/scores); unified `yahdle_join_game` (open + invited, slot reservation); `yahdle_list_open_games` now returns max_players + players_joined; `pending_for` honors the array.
  - `yahdle_forfeit_continue.sql` — adds `yahdle_players.forfeited`. In 3–4p a forfeit marks the player out (loss recorded at game end), skips their seat, others play on; game finishes only when ≤1 active remains (2p forfeit still ends → other wins). `claim_inactive_win` boots just the idle current player and continues. `advance_turn`/`finalize` skip forfeited players.
- **Client:** Wordy-style create sheet (2/3/4 picker + multi-friend select); MultiGamePage renders a pill per player (current lit ✨, tap opponent → their card), N-column GameOverComparison, waiting-room "X/N seats", "🏳️ you forfeited" screen + dimmed/struck forfeited pills; lobby array-aware (all invitees see the invite; sent/open rows show seat counts).
- **Board opens while filling (Rae's call):** create → game sits in the lobby; tap it to open the board and watch pills fill in. NOT auto-navigated on create. Playable when the last seat fills.
- **BUGFIX (Dino couldn't see a game he joined):** a `waiting` game you JOINED fell into no lobby bucket for non-creators (pending excludes you once you're a player; `sent` was creator-only). Fixed: `sent` bucket = `waiting && amPlayer` in `useMultiplayerLobby`, and the lobby waiting row is now tappable (creator keeps ×-cancel; joined non-creator gets →).
- **Push:** `game_invited` fans out to all `invited_user_ids`; `game_finished` fans out to all N via `is_winner` (forfeiters get "X won"); `turn_change` already worked. My fan-out edits live in `index.ts` alongside the other session's `nudge` type.
- **c142 (auto-accept invited friends on board open):** already lived in MultiGamePage's auto-accept `useEffect` → **fledged**.
- **Gotcha (cost me time):** the pooler is **us-west-2** (`aws-0-us-west-2.pooler.supabase.com:5432`, user `postgres.<ref>`) — us-west-1 gives "Tenant or user not found". (CLAUDE.md already documented us-west-2; read it.) `supabase db push --yes` and direct `psql` to shared prod are blocked by the auto-mode classifier unless Rae grants perms; dashboard SQL editor is the no-perms fallback. PostgREST caches functions/columns — after a migration run `notify pgrst, 'reload schema';` or the new RPC/column 404s.

### 2026-05-27 — MP lobby restyled to Wordy chip layout + nudge feature

Rae wanted the multiplayer game list to look like Wordy's and to gain Wordy's "nudge" feature.

- **`MultiplayerCard.jsx`:** active games (was split your-turn / waiting with "vs X · Waiting · score · turn N/12" text rows) now render Wordy-style: player-name chips with the current-turn chip highlighted (`bg-wordy-500 text-white`, others `bg-wordy-200 text-wordy-700`), an `(n/n)` count pill, an "X ago" status line (from `last_activity_at`), and a `▶ Resume` button. your-turn + waiting merged into one `activeGames` list (whose-turn shown via the highlighted chip, like Wordy). Dropped the inline score/turn text for Wordy parity. Removed the now-unused `otherPlayerNames` helper. Chip dark-mode colors come free via shared `sq-ui/globals.css` `.dark .bg-wordy-*` overrides.
- **Nudge:** 🔔 inside the current player's chip on opponent's-turn games, gated by Wordy's exact logic — active, not my turn, turn idle > 12h, no nudge in last 12h. `displayName()` resolves my own chip name from `profile` (opponents map excludes self), so `profile` is now passed from `LobbyPage`.
- **Backend (Yahdle has NO direct UPDATE policy on `yahdle_games` — unlike Wordy, which writes `last_nudged_at` from the client):**
  - `yahdle_nudge.sql` migration: adds `last_nudged_at timestamptz` + SECDEF `yahdle_nudge(p_game_id)` RPC (participant check, not-my-turn, 12h cooldown on `last_activity_at` + `last_nudged_at`, returns the player to notify). Modeled on `yahdle_claim_inactive_win`. `last_activity_at` is a safe turn-start proxy: its touch trigger fires only on `yahdle_players`/`yahdle_turn_state` writes, NOT on a `yahdle_games` nudge write.
  - `sendNudge()` in `multiplayerActions.js`: calls the RPC, then fire-and-forget POSTs `{type:'nudge'}` to the `yahdle-push-notification` function.
  - Added `nudge` type to `yahdle-push-notification/index.ts` (mirrors Wordy: looks up current player, `sendIfOptedIn(yahdle, 'nudge')`).
- **Shipped:** migration run by Rae in the dashboard SQL editor; function deployed (now v6, smoke-tested — bogus game_id returns `game not active`, confirming the branch is live); frontend committed + pushed to `main` (GH Actions auto-deploy).
- **Gotchas for next time:**
  - `.env.supabase`'s `SUPABASE_ACCESS_TOKEN` is **expired/dead (401)**. The Supabase CLI has a valid **stored login** — so run CLI commands with `unset SUPABASE_ACCESS_TOKEN` to avoid the dead env token overriding it.
  - Pooler for psql: `aws-0-us-west-2.pooler.supabase.com`, session port **5432**, user `postgres.yyhewndblruwxsrqzart` (direct `db.<ref>.supabase.co` host no longer resolves).
  - Couldn't headlessly verify the authed lobby visual (SQ login wall) — confirmed via clean production build + faithful 1:1 port of Wordy's working component. Worth Rae eyeballing the chips live.

### 2026-05-19 — Extended leaderboards (c92 — first game shipped)

Yahdle is the template for c92 (extended leaderboards across solo SQ games). Snibble and Rungles follow.

- **Renamed `📅 Today` tab → `🏆 Leaderboard`.** Same sub-page, now timeframe-aware.
- **New segmented control:** Day / Week / Month / All-time. When Day is active, a date stepper (`‹ Tue, May 19 ›`) lets you scroll back through past days — solves the "missed midnight" problem of not seeing yesterday's winner.
- **New RPCs** replace `yahdle_daily_leaderboard(p_date date)`:
  - `yahdle_solo_leaderboard(p_timeframe text, p_date date default current_date)` — top 10 per window. Day: single day's score. Week/Month/All: SUM(score) per user in window. Tie-break: completed_at ASC for day, max(completed_at) ASC for aggregates.
  - `yahdle_solo_my_rank(p_timeframe, p_date)` — caller's rank + score. Client appends a "your rank #N" row when rank > 10.
- **Old `yahdle_daily_leaderboard` left alive** — purely additive migration so live site never broke during cutover. Drop in a follow-up.
- **Migrations** (CLI-tracked, timestamp-prefixed — first ones in this repo to use the `<timestamp>_name.sql` convention; older migrations were applied manually via psql):
  - `20260519130000_yahdle_extended_leaderboards.sql` — new RPCs.
  - `20260519130100_fix_yahdle_solo_my_rank_ambiguity.sql` — fix CTE column `score` colliding with `RETURNS TABLE (... score int)` OUT param. CTE columns renamed to `uid` / `user_score` / `total_score`.
- **JSX bug caught in verify step:** `formatIso` rendered UTC-midnight Date with the default formatter, which rolled back a day for Atlantic-time clients. Fixed by adding `timeZone: 'UTC'` to the `DATE_FMT` formatter. Lesson: when rendering pure calendar dates from ISO strings, both construction AND formatting must agree on timezone.
- **Window definitions** (computed in SQL relative to `p_date` so server stays tz-agnostic): week = `date_trunc('week', p_date)` (Monday-start, ISO), month = `date_trunc('month', p_date)`, all = no bounds.
- **Past-day visibility:** open to everyone (no play-to-see gate). Matches the locked c92 decision for Snibble too.
- **Histogram + Quick Stats dropped** from the leaderboard tab. They drew on the full player list (>10) which the new top-10 RPC doesn't return. If Rae misses them, add a separate RPC + section; not done now.
- **Removed code:** `TodayTab` (replaced by `LeaderboardTab`), `Histogram` component.
- **Verified locally end-to-end** at `localhost:8080/yahdle/stats` with Rae logged in as test account. All four tabs render real prod data correctly; date stepper time-travels correctly; sum aggregation confirmed (Rae: Day Tue 70 + Day Mon 77 = Week 147).
- Raeban card [c92] still in flight (Snibble + Rungles pending).

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


### 2026-05-13 — Drop orphan rng_salt column

`yahdle_games.rng_salt` was scaffolded in the initial multiplayer schema with the intent of someday powering a deterministic MP RNG (replay mode, tournament parity, anti-cheat). Never wired — `yahdle_roll_one_die()` uses live `random()`, solo uses date-seeded mulberry32, nothing reads the salt.

Audit before dropping (100% safe):
- Single grep hit across yahdle/, rae-side-quest/, snibble/, wordy/, rungles/: the column definition itself
- `pg_depend`: only the column's own default depends on it
- No functions, views, or triggers reference rng_salt
- No frontend types/code references it

Migration: `supabase/migrations/yahdle_drop_rng_salt.sql` — `alter table public.yahdle_games drop column if exists rng_salt;`. Baseline `yahdle_multiplayer_schema.sql` updated to match.

If we ever ship deterministic MP RNG, re-add a salt column (or per-turn nonces) when the feature actually lands.

**Commit:** `6827ae2`.

## 2026-05-31 — Opt-in decline-notify (c172)

Yahdle already had decline (yahdle_decline_invite, deletes the waiting 1v1 row). Phase 2 (yahdle_decline_notify.sql): CREATE OR REPLACE captures created_by via RETURNING before the delete, then net.http_post's an 'invite_declined' push to yahdle-push-notification edge fn, gated by the new per-game 'invite_declined' notif topic (default OFF, opt-in in hub NotificationsPanel). Edge fn handles the type via sendIfOptedIn. Verified via rolled-back impersonation test (row deleted + exactly-1-push) + live smoke test on deployed fn. Authed device-side push NOT E2E'd — Rae to confirm.
