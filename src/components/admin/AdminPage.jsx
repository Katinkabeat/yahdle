import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  SQLobbyShell,
  SQLobbyHeader,
} from '../../../../rae-side-quest/packages/sq-ui'
import { supabase } from '../../lib/supabase.js'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'

// Admin panel — Close Games view only. Admin permissions are managed
// from the SQ hub (see rae-side-quest's admin tooling), so this page
// only surfaces the per-game action a master admin grants you.
//
// Routed at /admin. Settings dropdown's admin row navigates here when
// the signed-in user has a row in `public.admins` with `close_games`
// in `permissions`.
//
// Wires to two RPCs created by supabase/migrations/yahdle_admin_close_game.sql:
//   - yahdle_admin_list_open_games() — list waiting/active games
//   - yahdle_admin_close_game(uuid)  — soft-close a game (no winner)
//
// If your game's table is named differently (e.g. yahdle_matches),
// update the RPC names + the column references when you wire your
// data layer.
export default function AdminPage({ session, profile, isAdmin }) {
  const navigate = useNavigate()
  const [games, setGames]         = useState([])
  const [closingId, setClosingId] = useState(null)
  const [loading, setLoading]     = useState(true)

  // Hard gate: non-admins shouldn't reach this URL. Bounce them home
  // rather than rendering an empty panel — the UI shouldn't suggest
  // a feature they don't have access to.
  useEffect(() => {
    if (!isAdmin) navigate('/', { replace: true })
  }, [isAdmin, navigate])

  const loadGames = useCallback(async () => {
    const { data, error } = await supabase.rpc('yahdle_admin_list_open_games')
    if (error) {
      console.error('yahdle_admin_list_open_games failed:', error)
      toast.error(`Couldn't load games: ${error.message}`)
    }
    setGames(data ?? [])
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    setLoading(true)
    loadGames().finally(() => setLoading(false))
  }, [isAdmin, loadGames])

  async function closeGame(gameId) {
    setClosingId(gameId)
    try {
      const { error } = await supabase.rpc('yahdle_admin_close_game', { p_game_id: gameId })
      if (error) throw error
      toast.success('Game closed.')
      setGames(prev => prev.filter(g => g.id !== gameId))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClosingId(null)
    }
  }

  if (!isAdmin) return null

  return (
    <SQLobbyShell
      header={
        <SQLobbyHeader
          title="Yahdle"
          avatarSlot={<AvatarMenu profile={profile} />}
          rightSlot={<HeaderRight isAdmin={isAdmin} />}
        />
      }
    >
      <button
        type="button"
        onClick={() => navigate('/')}
        className="text-sm font-bold opacity-70 hover:opacity-100 self-start"
      >
        ← Back to lobby
      </button>

      <section className="card">
        <h2 className="font-display text-xl mb-1">🔒 Close Games</h2>
        <p className="text-sm opacity-70 mb-3">
          Close old or stuck games. They'll be marked finished with no
          winner attribution and show up in history as "🛑 Game closed
          by admin".
        </p>

        {loading ? (
          <p className="text-sm opacity-60 italic">Loading…</p>
        ) : games.length === 0 ? (
          <p className="text-sm opacity-60 italic">No open games to close.</p>
        ) : (
          <ul className="space-y-2">
            {games.map(g => (
              <li
                key={g.id}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-white border border-purple-100 dark:bg-[#1f1240] dark:border-[#2d1b55]"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-display text-sm truncate">
                    {(g.player_names ?? []).join(' · ') || '(no players)'}
                  </div>
                  <div className="text-xs opacity-70">
                    {g.status} · {new Date(g.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => closeGame(g.id)}
                  disabled={closingId === g.id}
                  className="shrink-0 text-xs font-bold text-rose-600 dark:text-rose-300 hover:underline disabled:opacity-50"
                >
                  {closingId === g.id ? '…' : '✕ Close'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SQLobbyShell>
  )
}
