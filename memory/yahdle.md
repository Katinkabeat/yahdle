# Yahdle session memory

Per the SQ session memory convention, update this file at the end of every
Yahdle work session with: what changed, what's pending, and any gotchas.

**2026-07-12 (c274):** cross-game notification-tap routing fix. `main.jsx` now
calls `installNotificationNav()` (new sq-ui helper) — the hub SW posts a
`{type:'NAVIGATE', url}` message on a push tap and this navigates the already-open
app to the target board. `clients.openWindow()` was a no-op inside an already-running
installed PWA on Android, which is why taps did nothing / stayed on the wrong board.
Commit `cb9968a`. Substantive fix is in the hub (`public/sw.js` +
`sq-ui/utils/notificationNav.js`); Yahdle only wires the receiver. See auto-memory
`feedback_sq_notification_click_routing`.

**2026-07-10 (c262):** `requestRematch` (`src/lib/multiplayerActions.js`) now uses
`firePushAndReport` from `sq-ui/utils/report.js` instead of a bare `.catch(()=>{})`
— a failed `rematch_requested` push is reported to the private `#error-log` Discord
channel (via the `sq-report-client-error` edge fn) instead of vanishing. No
`CACHE_VERSION` bump (sw.js is push-only, version is inert). Pipeline built in c265;
see the auto-memory `project_sq_error_log`.

## Game overview

Push-your-luck daily word-dice game

- Slug: `yahdle`
- Deploys to: https://katinkabeat.github.io/yahdle/
- Theme color: `#7c3aed`
- Background color: `#faf5ff`

## Session log

### 2026-07-09 — Nudge fixes (c248) + rematch pending row (c251)

Two of four SQ bugs Rae reported this session landed in Yahdle.

**Nudge (c248, commit `9cfca30`):**
- **Cooldown-on-success.** `yahdle_nudge` no longer stamps `last_nudged_at`; a new `yahdle_mark_nudged` RPC does, and the client calls it ONLY after the push POST returns ok (migration `yahdle_nudge_cooldown_on_success.sql`). Fixes the c239 residual where a failed push 12h-locked the game and retries hit "Already nudged recently."
- **Bell hidden for opted-out opponents.** `MultiplayerCard` gates the 🔔 on `isNudgeEnabled(currentPlayerId)` → `sq_notification_enabled(uid,'yahdle','nudge')` (same gate the edge fn uses). Reappears when they re-enable (prefs refetched per lobby reload). Fetched only for otherwise-eligible games (idle >12h, not my turn) to limit RPC fan-out.
- Friendlier failure copy; SW cache → yahdle-v10.

**Rematch pending row (c251, commit `64c219e`):**
- `useMultiplayerLobby` now emits `pendingRematches` = finished games where `rematch_requested_by == me && rematch_new_game_id is null`, excluded from `completed`. `MultiplayerCard` renders them like a sent-invite ("🔁 Rematch sent · ⏳ waiting for [opponent]") with a ✕ → `declineRematch`. Pure client. SW cache → yahdle-v11.
- Why display-only, not a real waiting game: keeps the c165 lightweight-flag handshake (a real waiting game would need invite-expiry cleanup). Rae's explicit call.

**Incoming rematch row (c252, commit `5efd6d8`):**
- The mirror of c251's sender row. Before this, the recipient could ONLY accept/decline a rematch from the finished game's game-over screen (`RematchControls` in `GameOverComparison`) — once back in the lobby there was no surface, so a requested rematch looked ignorable. `useMultiplayerLobby` now also emits `incomingRematches` = finished 1v1 games where `rematch_requested_by` is set, isn't me, no `rematch_new_game_id`, and I'm a seated player; excluded from `completed` and `pendingRematches`. `MultiplayerCard` renders them near the top (actionable) like a pending invite: "🎲 {opp} wants a rematch!" + Accept (`acceptRematch` → navigate to new game) / × Decline (`declineRematch`). Pure client, no DB change (handshake RPCs already existed). SW cache → yahdle-v12.
- Live-update note: UPDATE to the finished game fires the recipient's lobby realtime only if they're `created_by`/`invited_user_id` on it (open-game joiners fall back to the 30s poll) — same asymmetry the sender row already had.

All three: build clean + app mounts; authed lobby render is the click-test boundary (SQ authed-verify limit). Data layer verified via rolled-back txns against Rae's real account.

### 2026-06-14 — Lobby "View today's result" (c216)

`SoloPlayCard.jsx` now queries `yahdle_solo_results` for today on mount and flips the
solo button from "▶ Play today" to "↗ View today's result" when a row exists (matches
Rungles' lobby). No "Played today" pill (added one, Rae had it removed — the button label
says it). Committed + pushed. Mirrors the same change in Snibble + the sq-game-starter template.

**Gotcha / follow-up (Raeban c218):** Yahdle's in-game daily is still gated by **localStorage
only** (`isGameOver` from local state in `SoloGamePage.jsx`), not server-side like Rungles.
So cross-device: the lobby correctly shows played, but clicking in loads an empty board and a
replay re-upserts (overwrites) today's `yahdle_solo_results` score. Low stakes; fix = server
gate + a summary results panel (do NOT store the full scorecard server-side; Rungles only stores a summary).

### 2026-06-07 — How-to: added a Multiplayer section (c185)

`HowToPlayModal.jsx` previously had **zero** MP coverage (all solo/daily). Added a
"Multiplayer" section at the bottom: New game in the lobby → 2–4 players, open or
invite friends, open games expire after 7 days unfilled; players take turns and
each build their own 12-category scorecard, highest total wins; 🔔 nudge after 12h
idle; claim-win from the settings cog ⚙ after 7 days idle. Pure copy, no logic
change. Committed + pushed. Part of a 4-game sweep documenting inactive-player rules.

### 2026-06-06 — single-rematch accept handshake (c165) SHIPPED

Replaced the unilateral rematch (both players could each fire `yahdle_rematch`, spawning two parallel games) with a one-open-request-per-game accept/decline handshake. **1v1 only**; N-player finished games (not creatable via the current lobby UI) keep the legacy unilateral `yahdle_rematch`. Built + deployed + verified at the DB layer and via a throwaway render harness. **CONFIRMED working in Rae's live two-session test (2026-06-06):** both players saw Rematch, clicking claimed it, the opponent got Accept/Decline, Accept dropped both into a fresh game. Only blemish — ~10s before the opponent's board flipped to Accept/Decline, which is the **same realtime-propagation latency** as the turn-change lag (c181), NOT a rematch bug.

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

- **Verified (c181, live test):** after forcing the new SW on both devices — **desktop Chrome flips INSTANT** (push-refresh confirmed), **Chrome Android 2–5s**. Desktop being instant proves the server push pipeline (trigger→pg_net→edge fn→push) is fast; the phone residual is **last-mile mobile delivery** (FCM + Android power mgmt waking the SW), outside our code — a floor every Android web-push PWA shares. Down from a flat ~15s. The 6s poll backstops it. Lever if ever needed: poll 6s→3s tightens mobile worst-case only.
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

## 2026-06-06 — Claim-inactive moved to sub-header for mobile (c153)
Yahdle already had `yahdle_claim_inactive_win` + canClaim, but the claim button was rendered inline on the opponent's-turn panel BELOW the tall scorecard — below the fold on phones, so mobile players never saw it (no responsive-hide class involved; pure layout). Moved it to the always-visible board sub-header rightSlot (next to Forfeit), shown only when canClaim; removed the inline button. No backend change. SW bumped v4→v5. Commit pushed.

## 2026-06-07 — Claim + forfeit moved into the cog (c153 revision)
Per Rae, standardized placement across all SQ games: moved BOTH claim and forfeit OUT of the sub-header and INTO the settings cog. Added a `gameRows` render-prop to lobby/SettingsDropdown.jsx (threaded through HeaderRight.jsx); MultiGamePage passes `cogGameRows`. Sub-header rightSlot is now empty. The claim row is ALWAYS shown for an active game and greyed unless it's the opponent's turn AND idle 7+ days (greying via sq-ui SQSettingsRow's new `disabled` prop). No backend change. SW bumped v5→v7. Rae verified: claim lit on a 25-day game, greyed on a fresh one, forfeit works from the cog, subheader clean.

## 2026-06-07 — timeAgo moved to shared sq-ui helper (c186)
Deleted the inline `timeAgo` in lobby/MultiplayerCard.jsx and imported the shared `timeAgo` from rae-side-quest/packages/sq-ui. The shared helper returns "" (not null) for empty input, so the call site changed from `timeAgo(x) ?? "🟢 In progress"` to `|| "🟢 In progress"`. No visible change.

## 2026-06-11 — Game-end push: end_reason + claim-mislabel fix (c188)
Yahdle ALREADY had a full game-finished push (on_yahdle_game_finished trigger + fan-out handler honoring is_winner + closed_by_admin). Only gap: a claim-inactive-win and a voluntary forfeit were indistinguishable on the row, so a claimed-against player was told "You forfeited the game." Added `yahdle_games.end_reason` ('claim'|'forfeit'), stamped in yahdle_forfeit_game / yahdle_claim_inactive_win. No trigger change (it already posts row_to_json(NEW), which now carries end_reason). Edge fn handler refined: a forfeit_user_id recipient with end_reason='claim' now gets "<winner> claimed the win because your turn was idle 7+ days."; a single winner on a forfeit finish gets "<forfeiter> forfeited, you win!". Kept the N-player win/tie/Rematch fan-out for everything else. Migration `supabase/migrations/yahdle_gameend_reason.sql` applied via pooler; fn deployed.

## 2026-07-02 — End-of-daily leaderboard shortcut (c240)
Added Lobby + Leaderboard buttons to the solo daily game-over card (`isGameOver` panel) in components/game/SoloGamePage.jsx: `btn-secondary` → `navigate('/')` (← Lobby) and `btn-primary` → `navigate('/stats')` (🏆 Leaderboard). Mirrors the pattern Oublex/Rungles already ship. `navigate` (react-router) was already in scope. Compile-verified via Vite transform (200); live end-game render not E2E'd (needs an authed full daily play). Commit a862004.

## 2026-07-02 — Removed "← you" leaderboard self-marker (Rae request)
Dropped the "← you" text label (Wordy: "(you)") from the leaderboard row in StatsPage. The `isYou`/`isMe` prop still drives the row highlight (bg-white/15 ring) — only the redundant text was removed. In-match "(you)" during live games left as-is (not a leaderboard). No Quill post (Rae's call, too small).

## 2026-07-02 — Server-side daily gate + re-entry results panel (c218)
Closed the localStorage-only gap flagged in c216: previously `SoloGamePage` derived game-over purely from local state, so on a **different device/browser** a played daily loaded an empty *playable* board and a replay re-upserted (overwrote) today's `yahdle_solo_results` score. Now mirrors Rungles' server gate.
- New helper `src/lib/soloResults.js` → `fetchDailyResult(userId, playDate)`: `maybeSingle()` select of `play_date, score` from `yahdle_solo_results` by `(user_id, play_date)`; returns the row or null. (Mirrors Rungles' `fetchTodayDaily`.)
- `SoloGamePage.jsx`: added `serverResult` state (`'checking' | null | row`). On mount, **skip the fetch when `isGameOver`** (local state already shows the full filled scorecard) or when there's no `userId` (dev) — else fetch. `checkingGate` shows a brief "Checking today's result…" line; `showServerPanel` (row present, local not complete) renders a read-only "Already played today" panel (score + Lobby/Leaderboard buttons) instead of the board. **Fail-open** on query error so a transient failure never locks a player out.
- Deliberately **did NOT** store the full per-category scorecard server-side (out of scope per card; Rungles only stores a summary too). Panel shows score only — `yahdle_solo_results` has just `(user_id, play_date, score, completed_at)`.
- Design note: the **same-device completed** path is unchanged — `isGameOver` true → server fetch skipped → existing "Done!" panel with full scorecard still renders on first paint.
- **Relation to c237** (midnight write-guard sweep): this is the **read/entry-side** gate; it prevents the replay *UI path* but a determined client could still POST. The airtight DB-side write guard is c237's job (Snibble reference first, then Yahdle's server guard layered on this). They stack cleanly — different layers.
- **Verification:** both modules Vite-transform clean (200, no import/syntax error); `yahdle_solo_results` columns confirmed against prod (`user_id uuid, play_date date, score int, completed_at timestamptz`) so the select is valid; render logic traced across all entry states. Live authed panel render **not** clicked through — standalone session-injection is bounced to the SQ hub login (`/games/?return=…`), the known authed-verify limit for these games; safe to spot-check live (regression risk is nil — the board only hides when an exact user+date row exists, fail-open otherwise). Cleaned up the throwaway test user + seeded row from prod after testing.

## 2026-07-02 — Server-side write guard, strict today-only (c237)
Closed the midnight write hole: `yahdle_solo_results` was a direct client upsert with `play_date` from the route param and RLS insert/update-own with no date check → a session left open past midnight could pad yesterday's board.
- New `supabase/migrations/yahdle_solo_results_write_guard.sql` (applied to prod via pooler): SECDEF `yahdle_record_daily_solo(p_play_date, p_score)` — stamps user_id from auth.uid(), **STRICT today-only** (past days immutable). Dropped the insert/update RLS policies (read-own stays); RPC is the only writer.
- Why strict (unlike Snibble's finalize grace): Yahdle stores nothing until the game is finished — it writes only the final score, all at once — so a "yesterday" write after midnight is indistinguishable from padding. Can't protect the honest cross-midnight finisher without server-side in-progress tracking (c218 kept that out of scope). So a game finished after its day ended isn't recorded.
- `src/components/game/SoloGamePage.jsx`: game-over write now calls the RPC; derives `dayClosed = gameId !== atlanticYMD()`, skips the guaranteed-reject write and shows a "Day ended 🌙 — this puzzle's day ended at midnight, won't be recorded" note instead of "Done!".
- Zero-downtime rollout: RPC applied first, client pushed (commit 2af1660), live bundle confirmed, then policies dropped. Guard SQL-verified (past→reject, today→allow). Note: first Pages deploy hit a transient "Deployment failed, try again later" — re-ran the workflow. Authed play-path not clicked through (hub-login bounce) — Rae to confirm end-game once.

## 2026-07-07 — Nudge push failures now surfaced (c239)
The nudge push was fire-and-forget (`.catch(() => {})` / warn-only), so a dropped POST left the nudger with a false "Reminder sent!" toast. Now the handler awaits the push, checks `res.ok`, and on a non-2xx or network error surfaces a failure toast instead of success (plus `console.warn`). Added an 8s `AbortController` cap so a hung edge fn can't spin the nudge button forever. Failure leaves the button available to retry.
Known limit (unchanged, out of scope): the RPC/update stamps `last_nudged_at` *before* the push, so a retry within 12h is still cooldown-blocked server-side. Verified: all four games build clean + boot; the failure toast itself needs an authed >12h-stale match to click (hub-login bounce = known authed-verify wall).

## 2026-07-09 — Solo daily write hardened (fire-and-forget → resilient) (SQ audit, c254 sibling)
Cross-game audit follow-up after the Oublex silent-write bug. Yahdle's daily-result write (`SoloGamePage.jsx`, the `isGameOver` useEffect calling `yahdle_record_daily_solo`) was fire-and-forget: no await, `console.error`-only on failure, no retry, no `refreshSession`, and the game-over panel read "Done!" regardless. A stale-token 401 (backgrounded mobile tab) silently dropped the daily score + streak credit. (No DB resume snapshot here — localStorage keeps the finished board — so no replay loop like Oublex/Rungles; the failure is silent loss only.)
- **Fix:** extracted an async `recordDaily()` that awaits `yahdle_record_daily_solo`, and on failure calls `supabase.auth.refreshSession()` + backs off and retries up to 3×, keeping the existing `sessionStorage` "recorded" guard (set only on success). New `recordState` (idle|saving|error|saved) drives a `SaveStatus` in the "Done!" panel: "Saving your score…" / "Couldn't save your score. Retry saving" (button). Not shown when `dayClosed` (that path never records by design). Commit `9929319`.
- **Verified locally (preview, service_role session-injection + seeded 12/12 scorecard):** (1) success path — completed game on load → `recordDaily` → row written (score 60); (2) **self-heal** — tampered access token → console "attempt 1 failed" → `refreshSession()` → attempt 2 wrote the row (no error surfaced). Both live in-app. Test user + rows cleaned up.
- **SW note:** Yahdle's `sw.js` is push-only (no fetch/caches handler), so `CACHE_VERSION` is inert — not bumped (same as Oublex; unlike Rungles whose SW actually caches). New build reaches users on normal reload.
- Sibling fixes: Oublex (c254 done), Rungles (`cfcf274` done), Wordy (pending — same audit).

## 2026-07-10 — c248's cooldown stamp never ran: `.catch()` on a supabase thenable (false failure toast)
Rae nudged her Yahdle test game: **got an error toast, but the push arrived.** The inverse of the Wordy bug found the same morning (c260) — there the toast said success and nothing sent; here the toast said failure and the send worked.

**Root cause:** `sendNudge` (`src/lib/multiplayerActions.js:137`, shipped in c248) ended with
`await supabase.rpc('yahdle_mark_nudged', { p_game_id: gameId }).catch(() => {})`.
`supabase.rpc()` returns a **`PostgrestBuilder`, which is a thenable, not a Promise** — it implements `then()` but has **no `.catch()`**. So the chain throws `TypeError: ....catch is not a function` **synchronously, after the push has already been delivered**. The caller's try/catch turns that into "couldn't send" even though the nudge landed. Reproduced at runtime against supabase-js 2.105.3: `typeof builder.then === 'function'`, `typeof builder.catch === 'undefined'`, `builder instanceof Promise === false`.

**Second, quieter consequence:** because the TypeError fires *before* `yahdle_mark_nudged` resolves, **the 12h cooldown was never stamped once since c248 shipped.** Confirmed in prod: `max(yahdle_games.last_nudged_at)` = 2026-07-09 13:47 UTC, hours before c248 deployed (17:26 UTC). Yahdle nudges were effectively unthrottled for a day.

**Fix:** `const { error: markErr } = await supabase.rpc(...)`; `if (markErr) console.warn(...)`. Never throw on a failed stamp — the push landing is what "sent" means, and a stamp error must not report a failed send. Same invariant now holds in Wordy (c260) and Yahdle. SW → `yahdle-v13`. Commit `2d5e8a7`.

**Verified:** the RPC itself was never the problem — `yahdle_mark_nudged` exists, is SECURITY DEFINER, and `has_function_privilege('authenticated', …, 'EXECUTE')` is true. Proved old-vs-new line shape at runtime: old throws `TypeError`, new surfaces the error as a value and cannot throw. Build clean.

**Class of bug — check this on every new supabase call:** grepped `.rpc(...)/.from(...)` chained to `.catch(` across wordy/rungles/snibble/yahdle/oublex/rae-side-quest — **this was the only occurrence.** `.then()` works, `.catch()`/`.finally()` do not. Use `const { data, error } = await …` or wrap in `Promise.resolve()`.

## 2026-07-10 — Nudge bell gated on the opponent's opt-in + toast now reads `sent` (c259)
Generalised c248 (which shipped Yahdle-only) to all four games, and closed the hole c260 left open.

**Two changes, one invariant: never claim a nudge was sent unless a notification was actually delivered.**
1. **Bell gate.** The 🔔 only renders when the recipient has that game's `nudge` topic enabled (`sq_notification_enabled(uid, app, 'nudge')`). Fail-open: an RPC/transport error returns `true`, so a hiccup in a courtesy check never hides a bell that would have worked (the server re-checks the same pref anyway).
2. **Delivery check.** The push edge functions answer **HTTP 200** with `{sent:false, reason:'opted out'|'no push subscription'}` or `{skipped:'…'}`. `res.ok` therefore proves *nothing*. All four call sites now read the body and treat `sent !== true` as a failure. An unparseable 200 counts as delivered (fail-open — a false "couldn't send" on a nudge that landed is worse).

`no push subscription` is the common case, not `opted out`: a player with the pref ON who never granted browser permission. The bell gate does NOT catch that one — only the `sent` read does.

**Shared helper.** `rae-side-quest/packages/sq-ui/utils/nudge.js` — `isNudgeEnabled(supabase, userId, app)`, `postNudge({url, anonKey, body})` → `{delivered, reason, status}`, `nudgeFailureMessage(reason)`. sq-ui carries no deps, so the **caller passes its own supabase client**. Non-React lib files import `utils/nudge.js` directly (not the package index) so they don't drag the JSX components into their chunk. Games consume sq-ui by relative path, so no install step.

Failure copy never names the recipient's notification settings — "They're not set up to get reminders right now." Their prefs are their business, not the nudger's.

**Verified:** probed the four *live* edge fns with a bogus game id — all returned **200 + `{skipped}`**, i.e. the old `res.ok` code would have toasted "Reminder sent!" for a nudge that never left the server. Stubbed the remaining body shapes (`sent:true`, both `sent:false` reasons, 404, unparseable, network error) — all classify correctly. Gate proven at the data layer in a rolled-back txn against a real account: per-topic off → bell hides for that game only; back on → returns; per-app `_master` off → hides; global `_all/_master` off → hides everywhere. Vite `@fs` resolution of the new cross-package import confirmed 200 in all four dev servers. All four build clean. Bell click stays the authed boundary ([[feedback_sq_verification_constraint]]).
**Yahdle specifics:** was the reference impl; now the consumer. Its local `isNudgeEnabled` was deleted and re-exported as a thin app-bound wrapper (`userId => sqIsNudgeEnabled(supabase, userId, 'yahdle')`) so `MultiplayerCard.jsx` needed no change. `sendNudge`'s hand-rolled AbortController block collapsed into `postNudge`. The `yahdle_mark_nudged` stamp still runs only after a confirmed delivery, and still warns rather than throws (c261). SW → `yahdle-v14`. Commit `ac3c47a`.

## 2026-07-11 — Push address refresh-on-play + address-death alarm (c270 / c268)
Part of the platform-wide notification-reliability stack (watch card c269). Two changes landed in this game:
1. **Refresh-on-play (A1, c270):** `main.jsx` now calls `installPushHeal()` (from sq-ui) after `installGlobalErrorReporting`. It injects a hidden `/games/?heal=1` iframe — guarded by `Notification.permission==='granted'` (never prompts), once/session — that runs in the HUB service-worker scope and re-subscribes the shared `sidequest` push address while the user just plays. Closes the old "only heals on hub-open" gap for players who live in one game tab. The heal logic lives in the hub (`HealFrame.jsx` + `pushNotifications.ensurePushSubscribed`); this game only embeds the frame. All SQ apps are same-origin under `katinkabeat.github.io`, so the iframe shares localStorage + session.
2. **Address-death alarm (c268):** the push edge fn's 410/404→delete branch (`sendPushToUser`) now calls `reportAddressDeath` → posts a low-noise FYI to #error-log (game/user/topic/endpoint-host, as Rook) so a dead push address is no longer silent. `topic` threaded through `sendIfOptedIn → sendPushToUser`.
**Yahdle SW:** bumped `yahdle-v14 → v15`. Push fn: `supabase/functions/yahdle-push-notification/index.ts`. Deployed + smoke-tested 200.

## 2026-07-14 — Push retry + real status codes in #error-log (c276)
Yahdle surfaced the bug that drove the platform-wide fix: three #error-log alerts (`turn_change`, `rematch_requested`) reading only "Received unexpected response code" — web-push's generic `WebPushError.message`, with the real status/body discarded. Root cause was transient Mozilla push-service failures, not a dead address (re-sending succeeded; the endpoint was valid throughout).
- `yahdle-push-notification` now shares the platform send contract: `sendWithRetry` (2 retries, 400/1200ms backoff, on 5xx / 429 / no-status network errors), `pushErrDetail` (real status + body + host + user + attempts in the report), and a failed send returns `{sent:false}` instead of throwing (a throw used to abort the `game_finished` fan-out, so the *other* player got nothing).
- Per-game `app` fallback (`['sidequest','yahdle']`) removed — single `PUSH_APP = 'sidequest'` lookup. No SW bump needed (edge fn only, no client change).
- See `rae-side-quest/memory/rae-side-quest.md` (same date) for the cross-game detail and the test-send incident.

## 2026-07-14 (later) — the missing turn notification was pg_net, not the push fn (c278)
Yahdle again surfaced the platform bug. Rae had 2 games where it was her turn and got only 1 notification. `net._http_response` showed why: `f60389de`'s turn-change push **timed out in pg_net at 5031ms and was never sent**, while `90b3a7c8`'s (37s later) returned `{"sent":true}` and arrived. Not a tray/grouping issue — the push never left.
- Platform fix (all games): pg_net `timeout_milliseconds` 5s → 15s across 27 fns, plus a 9s ceiling on total retry time so the retry can't overrun pg_net's budget. See `rae-side-quest/memory/rae-side-quest.md` (same date).
- `yahdle-push-notification` responses now echo the notification `tag` + recipient, so the pg_net log names the game (`yahdle-turn-<gameId>`) instead of a bare `{"sent":true}`.
- Verified: a real turn push for `f60389de` then succeeded on the identical path that had silently dropped 19 minutes earlier.

## 2026-07-14 — Take-zero box no longer sticks around (UI fix)
Rae's repro: tap a category the word doesn't fit → "Take a 0?" box appears; tap a *different* category that does fit → it scores, but the ask box on the first category stayed up forever (nothing ever cleared `zeroAskCategory`, and the asked cell stays unfilled so it kept rendering).
- Fix: `tryScore` in both `SoloGamePage.jsx` and `MultiGamePage.jsx` now clears `zeroAskCategory` at the top, so tapping any category dismisses a stale ask (if the new tap also can't fit, the ask just moves to that cell). Solo's `confirmZero` also clears it explicitly, matching MP.
- Verified locally as Test (session-injection, solo daily): built TON, tapped 4-Letter → ask box; tapped 3-Letter → scored +3 and the box dismissed. No console errors. Commit `4a43b2b`, Quill posted.

## 2026-07-18 — Time-sensitive pushes send Urgency: high (c283)
Follow-up to the 2026-07-14 stale-notification investigation (c285): battery saver / Doze defers normal-urgency FCM delivery up to ~1h, so a your-turn push could display already stale. The push fn now sends `urgency: 'high'` for topics where a held-back delivery goes stale — `your_turn`, `nudge`, `invite`, `opponent_joined` (new `HIGH_URGENCY_TOPICS` set; `topic` threaded into `sendWithRetry`). Outcome topics (`game_finished`, `invite_declined`, `game_closed`) stay normal — FCM can deprioritize senders that blanket-mark pushes high. Same edit across all 8 SQ push fns + the sq-game-starter scaffold. Deno type-check clean; deployed; verified with a live wordy nudge to Rae (`sent:true` through the new path). Only narrows the stale window — the hard guarantee is the SW staleness guard (c284, still pending).
