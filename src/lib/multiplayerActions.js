import { supabase } from './supabase.js'

// Thin wrappers around the Yahdle multiplayer RPCs. All game state
// mutations go server-side (SECDEF) — this file just relays.

// Create a multiplayer game. invitedUserIds empty => an OPEN game any
// user can join (server caps one open game per creator). maxPlayers is
// 2–4; reserved invitee seats + open seats fill to that count.
export async function createGame({ invitedUserIds = [], maxPlayers = 2 } = {}) {
  const { data, error } = await supabase.rpc('yahdle_create_game', {
    p_invited_user_ids: invitedUserIds.length ? invitedUserIds : null,
    p_max_players: maxPlayers,
  })
  if (error) throw error
  return { gameId: data }
}

export async function acceptInvite(gameId) {
  const { error } = await supabase.rpc('yahdle_accept_invite', { p_game_id: gameId })
  if (error) throw error
}

// Join any waiting game with a free seat (open or one you're invited to).
// Server assigns the next player_index and auto-starts when full.
export async function joinGame(gameId) {
  const { error } = await supabase.rpc('yahdle_join_game', { p_game_id: gameId })
  if (error) throw error
}

// Back-compat alias — the join path is now unified server-side.
export async function joinOpenGame(gameId) {
  const { error } = await supabase.rpc('yahdle_join_open_game', { p_game_id: gameId })
  if (error) throw error
}

export async function listOpenGames() {
  const { data, error } = await supabase.rpc('yahdle_list_open_games')
  if (error) throw error
  return data ?? []
}

export async function declineInvite(gameId) {
  const { error } = await supabase.rpc('yahdle_decline_invite', { p_game_id: gameId })
  if (error) throw error
}

export async function cancelInvite(gameId) {
  const { error } = await supabase.rpc('yahdle_cancel_invite', { p_game_id: gameId })
  if (error) throw error
}

export async function rollDice(gameId) {
  const { data, error } = await supabase.rpc('yahdle_roll_dice', { p_game_id: gameId })
  if (error) throw error
  if (!Array.isArray(data) || data.length === 0 || data.some(f => f == null)) {
    throw new Error('Roll returned blank tiles — please try again')
  }
  return data
}

export async function parkDie(gameId, dieIdx) {
  const { error } = await supabase.rpc('yahdle_park_die', { p_game_id: gameId, p_die_idx: dieIdx })
  if (error) throw error
}

export async function unparkDie(gameId, builderIdx) {
  const { error } = await supabase.rpc('yahdle_unpark_die', { p_game_id: gameId, p_builder_idx: builderIdx })
  if (error) throw error
}

export async function swapLetters(gameId, a, b) {
  const { error } = await supabase.rpc('yahdle_swap_letters', { p_game_id: gameId, p_idx_a: a, p_idx_b: b })
  if (error) throw error
}

export async function scoreCategory(gameId, categoryId, word) {
  const { error } = await supabase.rpc('yahdle_score_category', {
    p_game_id: gameId, p_category_id: categoryId, p_word: word,
  })
  if (error) throw error
}

export async function takeZero(gameId, categoryId) {
  const { error } = await supabase.rpc('yahdle_take_zero', { p_game_id: gameId, p_category_id: categoryId })
  if (error) throw error
}

export async function clearBuilder(gameId) {
  const { error } = await supabase.rpc('yahdle_clear_builder', { p_game_id: gameId })
  if (error) throw error
}

export async function forfeitGame(gameId) {
  const { error } = await supabase.rpc('yahdle_forfeit_game', { p_game_id: gameId })
  if (error) throw error
}

export async function claimInactiveWin(gameId) {
  const { error } = await supabase.rpc('yahdle_claim_inactive_win', { p_game_id: gameId })
  if (error) throw error
}

// Nudge the current player that it's their turn. The RPC validates the
// caller is a waiting participant + enforces the 12h cooldown server-side;
// the push to the current player is fire-and-forget so the UI stays snappy.
export async function sendNudge(gameId, nudgerName) {
  const { error } = await supabase.rpc('yahdle_nudge', { p_game_id: gameId })
  if (error) throw error
  // The push IS the nudge, so (unlike the fire-and-forget pings below) we
  // await it and report failure — otherwise the nudger gets a false "sent"
  // toast when delivery silently dropped (c239). 8s cap so a hung edge fn
  // can't spin the nudge button forever.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  let ok = false
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/yahdle-push-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ type: 'nudge', game_id: gameId, nudger_name: nudgerName }),
      signal: ctrl.signal,
    })
    ok = res.ok
    if (!ok) console.warn(`[nudge] push failed: HTTP ${res.status}`)
  } catch (err) {
    console.warn('[nudge] push error:', err?.name === 'AbortError' ? 'timeout' : err)
  } finally {
    clearTimeout(timer)
  }
  if (!ok) throw new Error("Couldn't reach them just now — try again in a bit.")
  // Start the 12h cooldown only now that the push actually landed. yahdle_nudge
  // no longer stamps up-front, so a failed send above never locks the game.
  // supabase.rpc() returns a thenable, not a Promise — it has no .catch(), so
  // chaining one throws a TypeError *after* the push has gone out, surfacing as
  // a false "couldn't send" toast. Await and warn: the push landing is what
  // "sent" means, and a missed cooldown stamp must never report a failed send.
  const { error: markErr } = await supabase.rpc('yahdle_mark_nudged', { p_game_id: gameId })
  if (markErr) console.warn('[nudge] cooldown stamp failed:', markErr)
}

// Whether a user has Yahdle nudge notifications turned on. Used to hide the
// nudge bell for opponents who've opted out — no point offering an action that
// won't deliver. Mirrors the server's sendIfOptedIn('yahdle','nudge') gate, so
// the bell shows exactly when a nudge would actually get through. Fail-open
// (returns true on RPC error) to match the server.
export async function isNudgeEnabled(userId) {
  if (!userId) return false
  try {
    const { data, error } = await supabase.rpc('sq_notification_enabled', {
      p_user_id: userId, p_app: 'yahdle', p_topic: 'nudge',
    })
    if (error) return true
    return data !== false
  } catch {
    // Fail-open on a network/transport error — never let a lobby-side pref
    // check throw into the caller (would reject the Promise.all in the card).
    return true
  }
}

// Legacy unilateral rematch — still used as the fallback for N-player
// games, which don't have clean accept-handshake semantics.
export async function rematch(prevGameId) {
  const { data, error } = await supabase.rpc('yahdle_rematch', { p_game_id: prevGameId })
  if (error) throw error
  return { gameId: data }
}

// Single-rematch handshake (c165) — 1v1. requestRematch claims the one
// open slot on the finished game and fire-and-forget pings the opponent
// (reusing the invite push bucket). acceptRematch (called by the other
// player) spawns the fresh active game and returns its id. declineRematch
// clears the open request for either player; it does NOT notify.
export async function requestRematch(prevGameId) {
  const { error } = await supabase.rpc('yahdle_request_rematch', { p_game_id: prevGameId })
  if (error) throw error
  fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/yahdle-push-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ type: 'rematch_requested', game_id: prevGameId }),
  }).catch(() => {})
}

export async function acceptRematch(prevGameId) {
  const { data, error } = await supabase.rpc('yahdle_accept_rematch', { p_game_id: prevGameId })
  if (error) throw error
  return data // new game id
}

export async function declineRematch(prevGameId) {
  const { error } = await supabase.rpc('yahdle_decline_rematch', { p_game_id: prevGameId })
  if (error) throw error
}

// Admin-only — gated by the shared `public.admins` table's
// `close_games` permission. The RPC raises if the caller doesn't
// have it, so the UI can rely on the error for non-admin attempts.
export async function adminListOpenGames() {
  const { data, error } = await supabase.rpc('yahdle_admin_list_open_games')
  if (error) throw error
  return data ?? []
}

export async function adminCloseGame(gameId, reason) {
  const { error } = await supabase.rpc('yahdle_admin_close_game', {
    p_game_id: gameId,
    p_reason: reason,
  })
  if (error) throw error
}

// Read-side helpers ────────────────────────────────────────────

// Load the player's own private turn state. Opponent's is hidden by RLS.
export async function loadMyTurnState(gameId, userId) {
  const { data, error } = await supabase
    .from('yahdle_turn_state')
    .select('faces, builder, rolls_used, updated_at')
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data ?? { faces: [], builder: [], rolls_used: 0 }
}

export async function loadGame(gameId) {
  const { data, error } = await supabase
    .from('yahdle_games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function loadPlayers(gameId) {
  const { data, error } = await supabase
    .from('yahdle_players')
    .select('*')
    .eq('game_id', gameId)
    .order('player_index')
  if (error) throw error
  return data ?? []
}
