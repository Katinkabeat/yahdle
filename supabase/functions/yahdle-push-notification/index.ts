// Supabase Edge Function: yahdle-push-notification
//
// Trigger / call types — all sourced from yahdle_games row events:
//   1. game_invited     — yahdle_games AFTER INSERT (invited_user_id set).
//                         Notifies the invitee.
//   2. opponent_joined  — yahdle_games AFTER UPDATE, status waiting→active.
//                         Notifies the creator.
//   3. turn_change      — yahdle_games AFTER UPDATE, current_player_idx
//                         changed while status='active'. Notifies the new
//                         current player. One ping per turn change (no
//                         nagging follow-ups — per Rae).
//   4. game_finished    — yahdle_games AFTER UPDATE, status active→finished.
//                         Notifies both players with tailored body
//                         (won / lost / tie / opponent forfeited).
//   5. nudge            — client POST (after yahdle_nudge RPC stamps the
//                         12h cooldown). Reminds the current player it's
//                         their turn.
//   6. game_closed      — expire sweep closed a never-filled game (only
//                         the creator was seated). Notifies the creator.
//
// Reuses the unified push_subscriptions table. Every address is stored under
// the single 'sidequest' app — the hub is the only surface that subscribes.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PRIVATE_KEY    = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_PUBLIC_KEY     = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_SUBJECT        = Deno.env.get('VAPID_SUBJECT')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper: respect the recipient's notification prefs before sending.
// Calls sq_notification_enabled(user, app, topic) — if false, skip
// the send entirely. Fail-open on RPC error so a transient DB blip
// doesn't break the platform.
async function sendIfOptedIn(
  supabase: any,
  userId: string,
  app: string,
  topic: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string }
): Promise<{ sent: boolean; reason?: string; via?: string }> {
  const { data: enabled, error } = await supabase.rpc('sq_notification_enabled', {
    p_user_id: userId,
    p_app: app,
    p_topic: topic,
  })
  if (error) {
    console.error('sq_notification_enabled failed (fail-open):', error)
  } else if (enabled === false) {
    return { sent: false, reason: 'opted out' }
  }
  return sendPushToUser(supabase, userId, payload, topic)
}

// The one app every push address is stored under (see sendPushToUser).
const PUSH_APP = 'sidequest'

// ── Transient-failure retry (c276) ───────────────────────────────────────────
// A 5xx / 429 / timeout from a push service is that service having a moment, not
// a dead address. With no retry a single blip silently drops a real turn ping —
// the same player-goes-dark outcome reportAddressDeath (c268) guards the other
// half of. Retry twice with a short backoff; only a failure of every attempt is
// worth reporting.
const PUSH_RETRIES = 2
const PUSH_BACKOFF_MS = [400, 1200]

// Hard ceiling on total time spent retrying ONE recipient, across all attempts.
//
// The caller is a Postgres trigger going through pg_net, whose HTTP timeout is
// 15s (sq_pgnet_timeout_15s.sql). If we exceed that, pg_net severs the call and
// discards the response — the exact mechanism that was silently dropping turn
// notifications (c278). Retrying is only safe if we always answer well inside
// that window.
//
// A push service can fail SLOWLY: Mozilla was taking ~4.8s to return each 502.
// Three of those plus backoff is ~16s, which overruns even the raised budget —
// so an unbounded retry count turns one failed push into a severed call. Stop
// retrying once we're past the deadline and report instead; the attempt already
// in flight is allowed to finish (it may still succeed).
const PUSH_DEADLINE_MS = 9000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// No statusCode at all means the request never got an HTTP response back (DNS,
// socket, timeout) — transient too.
function isTransientPushError(err: any): boolean {
  const status = err?.statusCode
  if (status == null) return true
  return status === 429 || status >= 500
}

// Last 8 chars of the push endpoint — enough to tell one address from another
// without logging the whole (sensitive, capability-bearing) URL. Lets an
// #error-log line be correlated against the push_subscriptions row: same ep on a
// later failure = the address never healed; different ep = it rotated and the
// failure is the push service's, not a stale address.
function epFingerprint(endpoint: string): string {
  const s = String(endpoint ?? '')
  return s.length > 8 ? s.slice(-8) : (s || 'unknown')
}

// web-push's WebPushError message is always the generic "Received unexpected
// response code" — the push service's real status and body hang off the error
// object, never the message. Fold them in so the #error-log line is diagnosable.
function pushErrDetail(err: any, userId: string, app: string, endpoint: string, attempts: number): string {
  let host = 'unknown'
  try { host = new URL(endpoint).host } catch (_e) { /* keep 'unknown' */ }
  const status = err?.statusCode ?? 'no response'
  const body = String(err?.body ?? err?.message ?? err ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return `push send failed: ${status} — ${body} | app:${app} host:${host} ep:${epFingerprint(endpoint)} user:${userId} attempts:${attempts}`
}

// Sends, retrying transient failures. 410/404 propagate raw so the caller can run
// its expired-address cleanup; anything else surfaces as an enriched Error.
async function sendWithRetry(
  pushSubscription: any,
  payload: unknown,
  userId: string,
  app: string,
  endpoint: string,
): Promise<void> {
  const startedAt = Date.now()
  for (let attempt = 0; ; attempt++) {
    try {
      await webpush.sendNotification(pushSubscription, JSON.stringify(payload), { TTL: 86400 })
      return
    } catch (err: any) {
      if (err?.statusCode === 410 || err?.statusCode === 404) throw err
      const outOfTime = Date.now() - startedAt >= PUSH_DEADLINE_MS
      if (!isTransientPushError(err) || attempt >= PUSH_RETRIES || outOfTime) {
        throw new Error(pushErrDetail(err, userId, app, endpoint, attempt + 1))
      }
      await sleep(PUSH_BACKOFF_MS[attempt])
    }
  }
}

async function sendPushToUser(
  supabase: any,
  userId: string,
  payload: { title: string; body: string; tag: string; url: string; icon?: string },
  topic = 'unknown'
): Promise<{ sent: boolean; reason?: string; via?: string }> {
  // Every push address lives under the unified 'sidequest' app: the hub is the only
  // surface that ever calls pushManager.subscribe, and it hardcodes that value. The
  // old per-game fallback list ('wordy', 'rungles', …) dated from when each game
  // held its own notification settings; nothing has written a per-game row since the
  // unification and none survive in the table, so the loop only ever hit iteration
  // one. Single lookup now — a miss here means the user genuinely has no address.
  const { data: sub } = await supabase
    .from('push_subscriptions')
    .select('endpoint, keys_p256dh, keys_auth')
    .eq('user_id', userId)
    .eq('app', PUSH_APP)
    .maybeSingle()

  if (!sub) return { sent: false, reason: 'no push subscription', tag: payload.tag, user: userId }

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
  }

  try {
    await sendWithRetry(pushSubscription, payload, userId, PUSH_APP, sub.endpoint)
    return { sent: true, via: PUSH_APP, tag: payload.tag, user: userId }
  } catch (pushErr: any) {
    if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('app', PUSH_APP)
      await reportAddressDeath('Yahdle', userId, PUSH_APP, topic, pushErr.statusCode, sub.endpoint)
      return { sent: false, reason: 'address expired', tag: payload.tag, user: userId }
    }
    // One recipient's failed send is not the whole call's failure: throwing here
    // aborted the fan-out loops (game_finished), so the *other* players silently
    // got no push either. Report it and let the caller carry on.
    await reportServerError('Yahdle', topic, pushErr?.message ?? String(pushErr))
    return { sent: false, reason: 'send failed', tag: payload.tag, user: userId }
  }
}


async function getUsername(supabase: any, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle()
  return profile?.username ?? 'Someone'
}

function gameUrl(gameId: string): string {
  return `/yahdle/multi/${gameId}`
}

const ICON = '/yahdle/favicon.svg'

// Rotating quips for the invite_declined push — funny / bird / dog / ADHD
// flavoured, all warm rather than blunt. One picked at random per send.
// Rae-approved set (2026-05-31).
function declineBody(name: string, emoji: string): string {
  const quips = [
    `${name} flew the coop.`,
    `${name} chickened out.`,
    `${name} ducked out.`,
    `${name}'s not your wingman today.`,
    `${name} chased a squirrel instead.`,
    `${name} rolled over and bailed.`,
    `${name}'s in the doghouse.`,
    `${name} buried this one in the yard.`,
    `${name} got distracted by something shiny.`,
    `${name}'s brain changed the channel.`,
    `Ooh, squirrel — ${name}'s gone.`,
    `${name} flew south for this one.`,
  ]
  const quip = quips[Math.floor(Math.random() * quips.length)]
  return `${quip} Tap to start another. ${emoji}`
}

// Report an unexpected push-function failure to the private #error-log channel
// (c266 Phase 3). Best-effort; never throws. Only the top-level catch calls it,
// so routine 410/404 expired-subscription cleanup (handled inline) never lands here.
const ERRORLOG_WEBHOOK = Deno.env.get('SQ_DISCORD_ERRORLOG_WEBHOOK') ?? ''

// Report an expired-and-deleted push address to #error-log as a low-noise FYI
// (c268). A 410/404 on a *previously-valid* subscription silently darkens a
// real player — the exact blind spot that let Rae's turn pushes vanish for a
// day unnoticed. Distinct from reportServerError (a red alarm from the top-level
// catch): the SW self-heal (c252) + refresh-on-play (c270) re-create the address
// on the next rotation / hub-open / play, so this is an FYI, not an alarm.
async function reportAddressDeath(
  game: string, userId: string, app: string, topic: string, statusCode: number, endpoint: string
) {
  if (!ERRORLOG_WEBHOOK) return
  let host = 'unknown'
  try { host = new URL(endpoint).host } catch (_e) { /* keep 'unknown' */ }
  try {
    await fetch(ERRORLOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Rook',
        content: `**${game}** — push address expired (FYI)\n\`${statusCode} → sub deleted\` app:\`${app}\` topic:\`${topic}\` user:\`${userId}\` endpoint:\`${host}\` ep:\`${epFingerprint(endpoint)}\`\nSelf-heal re-subscribes on next rotation / hub-open / play.`,
        allowed_mentions: { parse: [] },
      }),
    })
  } catch (_e) {
    // best-effort: a failed report must never mask the push flow
  }
}

async function reportServerError(game: string, type: string, detail: string) {
  if (!ERRORLOG_WEBHOOK) return
  try {
    await fetch(ERRORLOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Rook',
        content: `**${game}** — push function error\n\`${type}\`\ndetail: ${String(detail ?? '').slice(0, 500)}`,
        allowed_mentions: { parse: [] },
      }),
    })
  } catch (_e) {
    // best-effort: a failed report must never mask the original error
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let payload: any = null
  try {
    payload = await req.json()
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── game_invited: yahdle_games INSERT with invitee(s) ──
    // Fans out to every invited user (multi-friend games), falling back
    // to the single invited_user_id for older 1v1 rows.
    if (payload.type === 'game_invited') {
      const { record } = payload
      const invitees: string[] = (Array.isArray(record?.invited_user_ids) && record.invited_user_ids.length)
        ? record.invited_user_ids
        : (record?.invited_user_id ? [record.invited_user_id] : [])
      if (!record?.id || !record.created_by || !invitees.length) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }
      const inviterName = await getUsername(supabase, record.created_by)
      const results: any[] = []
      for (const inviteeId of invitees) {
        const r = await sendIfOptedIn(supabase, inviteeId, 'yahdle', 'invite', {
          title: 'Yahdle — game invite',
          body: `${inviterName} invited you to a Yahdle game. Tap to play! 🎲`,
          tag: `yahdle-invite-${record.id}`,
          url: gameUrl(record.id),
          icon: ICON,
        })
        results.push({ user_id: inviteeId, ...r })
      }
      return new Response(JSON.stringify({ results }), { status: 200, headers: corsHeaders })
    }

    // ── invite_declined (from yahdle_decline_invite RPC) ──
    // Yahdle invites are 1v1; a decline deletes the waiting game.
    // Gated by the creator's 'invite_declined' pref (default OFF).
    if (payload.type === 'invite_declined') {
      const { game_id, creator_id, decliner_id } = payload
      if (!creator_id) {
        return new Response(JSON.stringify({ skipped: 'no creator' }), { status: 200, headers: corsHeaders })
      }
      const declinerName = decliner_id ? await getUsername(supabase, decliner_id) : 'A friend'
      const result = await sendIfOptedIn(supabase, creator_id, 'yahdle', 'invite_declined', {
        title: 'Yahdle',
        body: declineBody(declinerName, '🎲'),
        tag: `yahdle-declined-${game_id}`,
        url: '/yahdle/',
        icon: ICON,
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── rematch_requested: client POST after yahdle_request_rematch ──
    // A finished-game player claimed the single rematch slot; ping the
    // other player so they can accept. Reuses the 'invite' pref bucket
    // and tap target is the finished game (where Accept/Decline lives).
    if (payload.type === 'rematch_requested') {
      const { game_id } = payload
      const { data: game } = await supabase
        .from('yahdle_games')
        .select('id, created_by, invited_user_id, rematch_requested_by, status')
        .eq('id', game_id)
        .single()
      if (!game || game.status !== 'finished' || !game.rematch_requested_by) {
        return new Response(JSON.stringify({ skipped: 'no open request' }), { status: 200, headers: corsHeaders })
      }
      const requester = game.rematch_requested_by
      const recipient = requester === game.created_by ? game.invited_user_id : game.created_by
      if (!recipient) {
        return new Response(JSON.stringify({ skipped: 'no recipient' }), { status: 200, headers: corsHeaders })
      }
      const requesterName = await getUsername(supabase, requester)
      const result = await sendIfOptedIn(supabase, recipient, 'yahdle', 'invite', {
        title: 'Yahdle — rematch?',
        body: `${requesterName} wants a rematch! Tap to accept. 🎲`,
        tag: `yahdle-rematch-${game_id}`,
        url: gameUrl(game_id),
        icon: ICON,
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── opponent_joined: yahdle_games UPDATE waiting→active ──
    if (payload.type === 'opponent_joined') {
      const { record } = payload
      if (!record?.id || !record.created_by || !record.invited_user_id) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }
      const joinerName = await getUsername(supabase, record.invited_user_id)
      const result = await sendIfOptedIn(supabase, record.created_by, 'yahdle', 'opponent_joined', {
        title: 'Yahdle — opponent joined!',
        body: `${joinerName} joined your game. Time to play! 🎲`,
        tag: `yahdle-join-${record.id}`,
        url: gameUrl(record.id),
        icon: ICON,
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── turn_change: yahdle_games UPDATE current_player_idx changed ──
    if (payload.type === 'turn_change') {
      const { record, old_record } = payload
      if (!record || record.status !== 'active') {
        return new Response(JSON.stringify({ skipped: 'game not active' }), { status: 200, headers: corsHeaders })
      }
      if (old_record && record.current_player_idx === old_record.current_player_idx) {
        return new Response(JSON.stringify({ skipped: 'turn did not change' }), { status: 200, headers: corsHeaders })
      }

      const { data: currentPlayer } = await supabase
        .from('yahdle_players')
        .select('user_id')
        .eq('game_id', record.id)
        .eq('player_index', record.current_player_idx)
        .single()
      if (!currentPlayer) {
        return new Response(JSON.stringify({ skipped: 'player not found' }), { status: 200, headers: corsHeaders })
      }

      let moverName = 'Opponent'
      if (old_record && old_record.current_player_idx != null) {
        const { data: mover } = await supabase
          .from('yahdle_players')
          .select('user_id')
          .eq('game_id', record.id)
          .eq('player_index', old_record.current_player_idx)
          .single()
        if (mover) moverName = await getUsername(supabase, mover.user_id)
      }

      const result = await sendIfOptedIn(supabase, currentPlayer.user_id, 'yahdle', 'your_turn', {
        title: 'Yahdle — your turn!',
        body: `${moverName} played. Your move! 🎲`,
        tag: `yahdle-turn-${record.id}`,
        url: gameUrl(record.id),
        icon: ICON,
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── game_finished: yahdle_games UPDATE active→finished ──
    // Fans out to every player. Outcome comes from yahdle_players.is_winner
    // (authoritative for N players — the top-score group all win, so a
    // tie-for-first reads as a win for each tied player).
    if (payload.type === 'game_finished') {
      const { record } = payload
      if (!record?.id) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }
      // Admin closes are silent — they're only used for cleaning up
      // stuck test games. Players don't need a ping about them.
      if (record.closed_by_admin) {
        return new Response(JSON.stringify({ skipped: 'closed_by_admin' }), { status: 200, headers: corsHeaders })
      }

      const { data: pls } = await supabase
        .from('yahdle_players')
        .select('user_id, is_winner')
        .eq('game_id', record.id)
      const playerRows = pls ?? []
      if (!playerRows.length) {
        return new Response(JSON.stringify({ skipped: 'no players' }), { status: 200, headers: corsHeaders })
      }

      const winners = playerRows.filter((p: any) => p.is_winner)
      const winnerIds = new Set(winners.map((p: any) => p.user_id))
      const winnerNames: string[] = []
      for (const w of winners) winnerNames.push(await getUsername(supabase, w.user_id))
      const winnerLabel = winnerNames.join(' & ') || 'Someone'
      const tie = winners.length > 1

      const results: any[] = []
      for (const p of playerRows) {
        const userId = p.user_id
        let title = 'Yahdle — game over'
        let body: string

        if (record.forfeit_user_id === userId) {
          if (record.end_reason === 'claim') {
            // Claimed against while idle — NOT a voluntary forfeit.
            body = `${winnerLabel} claimed the win because your turn was idle 7+ days.`
          } else {
            body = 'You forfeited the game.'
          }
        } else if (winnerIds.has(userId)) {
          title = 'Yahdle — you won!'
          if (record.end_reason === 'forfeit' && !tie) {
            body = `${await getUsername(supabase, record.forfeit_user_id)} forfeited, you win!`
          } else {
            body = tie ? 'You tied for 1st! 🏆' : 'You won! 🏆'
          }
        } else {
          body = `${winnerLabel} won${tie ? ' (tie)' : ''}. Rematch? 🎲`
        }

        const r = await sendIfOptedIn(supabase, userId, 'yahdle', 'game_finished', {
          title,
          body,
          tag: `yahdle-finish-${record.id}`,
          url: gameUrl(record.id),
          icon: ICON,
        })
        results.push({ user_id: userId, ...r })
      }
      return new Response(JSON.stringify({ results }), { status: 200, headers: corsHeaders })
    }

    // ── game_closed: expire sweep closed a never-filled game ──
    // Only fires when just the creator was seated at expiry (unplayable),
    // so there's exactly one recipient. Reuses the game_finished pref
    // bucket so it honors the same opt-out.
    if (payload.type === 'game_closed') {
      const { record } = payload
      if (!record?.id || !record.created_by) {
        return new Response(JSON.stringify({ skipped: 'missing fields' }), { status: 200, headers: corsHeaders })
      }
      const result = await sendIfOptedIn(supabase, record.created_by, 'yahdle', 'game_finished', {
        title: 'Yahdle — game closed',
        body: 'Your game closed because no one else joined in time. 🎲',
        tag: `yahdle-closed-${record.id}`,
        url: '/yahdle/',
        icon: ICON,
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    // ── nudge: client POST, remind the current player it's their turn ──
    // The yahdle_nudge RPC has already validated eligibility; we just look up
    // who to ping and send. The client stamps the cooldown (yahdle_mark_nudged)
    // only after this succeeds, so a failed send doesn't lock the game.
    if (payload.type === 'nudge') {
      const { game_id, nudger_name } = payload
      const { data: game } = await supabase
        .from('yahdle_games')
        .select('current_player_idx, status')
        .eq('id', game_id)
        .single()
      if (!game || game.status !== 'active') {
        return new Response(JSON.stringify({ skipped: 'game not active' }), { status: 200, headers: corsHeaders })
      }
      const { data: currentPlayer } = await supabase
        .from('yahdle_players')
        .select('user_id')
        .eq('game_id', game_id)
        .eq('player_index', game.current_player_idx)
        .single()
      if (!currentPlayer) {
        return new Response(JSON.stringify({ skipped: 'player not found' }), { status: 200, headers: corsHeaders })
      }
      const result = await sendIfOptedIn(supabase, currentPlayer.user_id, 'yahdle', 'nudge', {
        title: 'Yahdle — your turn!',
        body: `${nudger_name || 'Someone'} is waiting for your move! 🔔`,
        tag: `yahdle-nudge-${game_id}`,
        url: gameUrl(game_id),
        icon: ICON,
      })
      return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ skipped: 'unknown type' }), { status: 200, headers: corsHeaders })
  } catch (err: any) {
    console.error('Yahdle push notification error:', err)
    await reportServerError('Yahdle', payload?.type ?? 'unknown', err?.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders })
  }
})
