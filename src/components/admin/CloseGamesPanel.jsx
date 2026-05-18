import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { adminListOpenGames, adminCloseGame } from '../../lib/multiplayerActions.js'

// Admin Close Games panel — shared pattern with Wordy/Snibble/Rungles.
// Lists every waiting/active yahdle_games row + lets an admin close
// one with a required reason. The close RPC checks the `close_games`
// permission on the shared `public.admins` table; non-admins who
// reach this page get an unauthorized error from the RPC.
export default function CloseGamesPanel() {
  const [games, setGames]           = useState([])
  const [closingId, setClosingId]   = useState(null)
  const [reasonFor, setReasonFor]   = useState(null)
  const [reasonText, setReasonText] = useState('')
  const [loading, setLoading]       = useState(true)

  const loadGames = useCallback(async () => {
    try {
      const rows = await adminListOpenGames()
      setGames(rows)
    } catch (err) {
      console.error('yahdle_admin_list_open_games failed:', err)
      toast.error(`Couldn't load games: ${err.message}`)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    loadGames().finally(() => setLoading(false))
  }, [loadGames])

  function startClose(gameId) {
    setReasonFor(gameId)
    setReasonText('')
  }

  function cancelClose() {
    setReasonFor(null)
    setReasonText('')
  }

  async function confirmClose(gameId) {
    const reason = reasonText.trim()
    if (!reason) {
      toast.error('Please enter a reason for closing this game.')
      return
    }
    setClosingId(gameId)
    try {
      await adminCloseGame(gameId, reason)
      toast.success('Game closed.')
      setGames(prev => prev.filter(g => g.id !== gameId))
      cancelClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClosingId(null)
    }
  }

  if (loading) {
    return (
      <section className="card">
        <p className="text-wordy-500 text-sm">Loading open games…</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2 className="font-display text-xl text-wordy-700 dark:text-wordy-200 mb-1">
        🔒 Close Games
      </h2>
      <p className="text-sm text-wordy-600 dark:text-wordy-300 mb-3">
        Close old or stuck games. They'll stop appearing in lobbies and no
        winner will be attributed. Both players get a push with your reason.
      </p>
      {games.length === 0 ? (
        <p className="text-sm text-wordy-500 italic">No open games to close.</p>
      ) : (
        <ul className="space-y-2">
          {games.map(g => {
            const isPrompting = reasonFor === g.id
            return (
              <li
                key={g.id}
                className="rounded-xl px-3 py-2.5 bg-white border border-wordy-100 dark:bg-[#1f1240] dark:border-[#2d1b55]"
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-sm text-wordy-700 dark:text-wordy-100 truncate">
                      {(g.player_names ?? []).join(' · ') || '(no players)'}
                    </div>
                    <div className="text-xs text-wordy-500 dark:text-wordy-300">
                      {g.status} · {new Date(g.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  {!isPrompting && (
                    <button
                      type="button"
                      onClick={() => startClose(g.id)}
                      disabled={closingId === g.id}
                      className="shrink-0 text-xs font-bold text-rose-600 dark:text-rose-300 hover:underline disabled:opacity-50"
                    >
                      {closingId === g.id ? '…' : '✕ Close'}
                    </button>
                  )}
                </div>
                {isPrompting && (
                  <div className="mt-2 space-y-2">
                    <input
                      type="text"
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      placeholder="Reason for closing (required)"
                      autoFocus
                      maxLength={200}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmClose(g.id)
                        if (e.key === 'Escape') cancelClose()
                      }}
                      className="w-full px-2 py-1.5 rounded-lg border border-wordy-200 dark:border-[#2d1b55] dark:bg-[#1a0e30] text-xs text-wordy-700 dark:text-wordy-100 focus:border-wordy-400 focus:outline-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelClose}
                        disabled={closingId === g.id}
                        className="text-xs font-bold text-wordy-500 dark:text-wordy-300 hover:underline disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmClose(g.id)}
                        disabled={closingId === g.id || !reasonText.trim()}
                        className="text-xs px-3 py-1 rounded-lg font-bold bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50"
                      >
                        {closingId === g.id ? '…' : 'Confirm Close'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
