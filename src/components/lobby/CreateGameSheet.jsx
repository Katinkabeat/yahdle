import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useFriends } from '../../hooks/useFriends.js'
import { createGame } from '../../lib/multiplayerActions.js'

// Yahdle MP CreateGameSheet — friend-invite only, 1v1.
// Reads friends from the SQ hub `friendships` table.
export default function CreateGameSheet({ user, onClose, onCreated }) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const { friends, loading: friendsLoading } = useFriends(user?.id)

  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filteredFriends = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return friends
    return friends.filter(f => f.username?.toLowerCase().includes(q))
  }, [friends, search])

  async function handleSendInvite() {
    if (submitting || !selectedId) return
    setSubmitting(true)
    try {
      const { gameId } = await createGame(selectedId)
      const opp = friends.find(f => f.id === selectedId)
      toast.success(opp ? `Invite sent to ${opp.username}.` : 'Invite sent.')
      onCreated(gameId)
    } catch (err) {
      toast.error(err.message || 'Failed to create game')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60" />
      <div
        className={`relative w-full sm:max-w-md mx-auto bg-[#181c25] rounded-t-2xl sm:rounded-2xl border border-white/10 p-4 transition-transform ${open ? 'translate-y-0' : 'translate-y-full sm:translate-y-0'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg">New Yahdle game</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="card p-3 mb-3">
          <div className="text-[10px] uppercase tracking-wide opacity-60 font-bold mb-1">Invite a friend</div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search friends…"
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1.5 mb-4 max-h-72 overflow-y-auto">
          {friendsLoading && <div className="text-sm opacity-60 text-center py-4">Loading friends…</div>}
          {!friendsLoading && friends.length === 0 && (
            <div className="text-sm opacity-60 text-center py-4">
              You don't have any friends yet. Add some from the hub Friends panel.
            </div>
          )}
          {!friendsLoading && friends.length > 0 && filteredFriends.length === 0 && (
            <div className="text-sm opacity-60 text-center py-4">No friends match "{search}".</div>
          )}
          {filteredFriends.map(f => {
            const sel = selectedId === f.id
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedId(f.id)}
                className={`w-full text-left card p-3 flex items-center justify-between transition ${sel ? 'border-wordy-500 bg-wordy-700/20' : 'hover:border-white/20'}`}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: `hsl(${f.avatar_hue ?? 270} 50% 50%)` }}
                  >
                    {f.username?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="text-sm font-semibold">{f.username}</div>
                </div>
                {sel && <span className="text-wordy-400 font-bold text-sm">✓</span>}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={handleSendInvite}
          disabled={!selectedId || submitting}
          className="w-full btn-primary disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Send invite'}
        </button>
      </div>
    </div>
  )
}
