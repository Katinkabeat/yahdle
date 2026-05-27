import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useFriends } from '../../hooks/useFriends.js'
import { createGame } from '../../lib/multiplayerActions.js'

// Yahdle MP CreateGameSheet — mirrors Wordy's New Game sheet:
//   • Player count picker (2–4).
//   • Open game: drops in the lobby for anyone to join.
//   • With friends: reserve seats for picked friends (up to count-1);
//     any remaining seats fill from the open lobby.
export default function CreateGameSheet({ user, onClose, onCreated }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('open') // 'open' | 'friend'
  const [maxPlayers, setMaxPlayers] = useState(2)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const { friends, loading: friendsLoading } = useFriends(user?.id)

  const inviteLimit = maxPlayers - 1
  const openSeats = Math.max(0, maxPlayers - 1 - selectedIds.size)

  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Lowering the player count can't leave more invitees than seats.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size <= maxPlayers - 1) return prev
      const next = new Set()
      for (const id of prev) {
        if (next.size >= maxPlayers - 1) break
        next.add(id)
      }
      return next
    })
  }, [maxPlayers])

  const filteredFriends = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return friends
    return friends.filter(f => f.username?.toLowerCase().includes(q))
  }, [friends, search])

  function toggleFriend(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (next.size >= inviteLimit) {
          toast(`Up to ${inviteLimit} friend${inviteLimit > 1 ? 's' : ''} for a ${maxPlayers}-player game.`)
          return prev
        }
        next.add(id)
      }
      return next
    })
  }

  async function handleCreate() {
    if (submitting) return
    if (mode === 'friend' && selectedIds.size === 0) return
    setSubmitting(true)
    try {
      const invitedUserIds = mode === 'friend' ? [...selectedIds] : []
      const { gameId } = await createGame({ invitedUserIds, maxPlayers })
      if (mode === 'friend') {
        toast.success(invitedUserIds.length === 1 ? 'Invite sent.' : `Invites sent to ${invitedUserIds.length} friends.`)
      } else {
        toast.success('Open game created — anyone can join.')
      }
      onCreated(gameId)
    } catch (err) {
      toast.error(err.message || 'Failed to create game')
    } finally {
      setSubmitting(false)
    }
  }

  const tabBase = 'flex-1 text-sm font-bold py-2 rounded-lg transition'
  const tabOn = 'bg-wordy-500 text-white'
  const tabOff = 'text-wordy-400 hover:text-wordy-200'

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

        {/* Player count */}
        <div className="text-[10px] uppercase tracking-wide opacity-60 font-bold mb-1">Players</div>
        <div className="flex gap-1 p-1 mb-3 rounded-xl bg-black/30 border border-white/10">
          {[2, 3, 4].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setMaxPlayers(n)}
              className={`${tabBase} ${maxPlayers === n ? tabOn : tabOff}`}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Mode */}
        <div className="flex gap-1 p-1 mb-3 rounded-xl bg-black/30 border border-white/10">
          <button type="button" onClick={() => setMode('open')} className={`${tabBase} ${mode === 'open' ? tabOn : tabOff}`}>
            🎲 Open game
          </button>
          <button type="button" onClick={() => setMode('friend')} className={`${tabBase} ${mode === 'friend' ? tabOn : tabOff}`}>
            👥 With friends
          </button>
        </div>

        {mode === 'open' ? (
          <div className="card p-3 mb-4">
            <div className="text-[10px] uppercase tracking-wide opacity-60 font-bold mb-1">Open game</div>
            <p className="text-sm opacity-80">
              Drops your {maxPlayers}-player game in the lobby for anyone to join. Starts once {maxPlayers} players are in. Expires after 7 days if it doesn't fill.
            </p>
            <p className="text-[11px] opacity-60 mt-2">Limit one open game at a time per player.</p>
          </div>
        ) : (
          <>
            <div className="card p-3 mb-3">
              <div className="text-[10px] uppercase tracking-wide opacity-60 font-bold mb-1">
                Invite friends — pick up to {inviteLimit}
              </div>
              <p className="text-[11px] opacity-60 mb-2">
                {selectedIds.size > 0 && openSeats > 0
                  ? `${selectedIds.size} invited · ${openSeats} open seat${openSeats > 1 ? 's' : ''} fill from the lobby.`
                  : openSeats > 0
                    ? `Their seats are reserved; ${openSeats} remaining seat${openSeats > 1 ? 's' : ''} fill from the open lobby.`
                    : 'All seats reserved for the friends you pick.'}
              </p>
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
                const sel = selectedIds.has(f.id)
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleFriend(f.id)}
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
          </>
        )}

        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting || (mode === 'friend' && selectedIds.size === 0)}
          className="w-full btn-primary disabled:opacity-50"
        >
          {submitting
            ? (mode === 'open' ? 'Creating…' : 'Sending…')
            : (mode === 'open'
                ? `Create open game (${maxPlayers}p)`
                : `Send ${selectedIds.size || ''} invite${selectedIds.size === 1 ? '' : 's'}`.replace('  ', ' '))}
        </button>
      </div>
    </div>
  )
}
