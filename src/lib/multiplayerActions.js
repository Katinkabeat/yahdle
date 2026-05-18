import { supabase } from './supabase.js'

// Thin wrappers around the Yahdle multiplayer RPCs. All game state
// mutations go server-side (SECDEF) — this file just relays.

// invitedUserId may be null to create an OPEN game any user can join.
// Server caps one open game per creator at a time.
export async function createGame(invitedUserId) {
  const { data, error } = await supabase.rpc('yahdle_create_game', {
    p_invited_user_id: invitedUserId ?? null,
  })
  if (error) throw error
  return { gameId: data }
}

export async function acceptInvite(gameId) {
  const { error } = await supabase.rpc('yahdle_accept_invite', { p_game_id: gameId })
  if (error) throw error
}

// Join someone else's open game. Server flips status→active and sets
// invited_user_id = the joiner so the rest of the schema (RLS, push
// triggers, pending_for) keeps working unchanged.
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

export async function rematch(prevGameId) {
  const { data, error } = await supabase.rpc('yahdle_rematch', { p_game_id: prevGameId })
  if (error) throw error
  return { gameId: data }
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
