// Middle lobby card — multiplayer entry point: Create button, list of open
// joinable games, list of the player's active games. Empty state is plain
// text (no big bubble emoji per SQ convention).
//
// TODO wire up:
//   - handleCreate -> insert a new game row, then DO NOT navigate. The new
//     row arrives via the realtime subscription below and renders in the
//     list — no dead-end "match posted" screen needed.
//   - openGames    -> fetched + realtime-subscribed list of joinable games
//   - myGames      -> fetched + realtime-subscribed list of the user's active games
//
// LOBBY REALTIME PATTERN (use the shared `useRealtimeChannel` hook):
//
//   useRealtimeChannel({
//     channelName: `lobby_yahdle_${userId}`,
//     subscriptions: [
//       // The user's own created games:
//       { event: '*', schema: 'public', table: 'yahdle_games',
//         filter: `created_by=eq.${userId}` },
//       // Games the user was invited to:
//       { event: '*', schema: 'public', table: 'yahdle_games',
//         filter: `invited_user_id=eq.${userId}` },
//       // The user's player rows (for state-of-play changes):
//       { event: '*', schema: 'public', table: 'yahdle_players',
//         filter: `user_id=eq.${userId}` },
//     ],
//     onChange: refetchLobby,
//     pollMs: 30_000,
//     enabled: !!userId,
//   })
//
// IMPORTANT: realtime delivers nothing until your tables are added to the
// `supabase_realtime` publication. Add to your initial migration:
//
//   alter publication supabase_realtime add table public.yahdle_games;
//   alter publication supabase_realtime add table public.yahdle_players;
//
// And: also patch the SQ hub (rae-side-quest) to subscribe to your tables
// in `LandingPage.jsx`'s `hub-inbox` channel + add a `yahdle_pending_for(uid)`
// SQL function so this game's pending counts show in the hub bell.
export default function MultiplayerCard({
  openGames = [],
  myGames = [],
  onCreate,
  creating = false,
  onEnterGame,
}) {
  const hasAny = openGames.length > 0 || myGames.length > 0

  return (
    <section className="card">
      <h2 className="font-display text-xl mb-1">🎮 Multiplayer</h2>
      <p className="text-sm opacity-80 mb-3">
        Create a game or jump into an open one.
      </p>
      <button
        type="button"
        className="btn-primary mb-4"
        onClick={onCreate}
        disabled={creating}
      >
        {creating ? '⏳ Creating…' : '✨ Create game'}
      </button>

      {hasAny ? (
        <div className="space-y-2">
          {openGames.map((g) => (
            <button
              key={g.id}
              type="button"
              className="w-full text-left rounded-xl border border-purple-200 dark:border-[#2d1b55] px-3 py-2 hover:bg-purple-50 dark:hover:bg-[#1a1130]"
              onClick={() => onEnterGame?.(g.id)}
            >
              <div className="text-sm font-bold">Open game</div>
              <div className="text-xs opacity-70">Tap to join</div>
            </button>
          ))}
          {myGames.map((g) => (
            <button
              key={g.id}
              type="button"
              className="w-full text-left rounded-xl border border-purple-200 dark:border-[#2d1b55] px-3 py-2 hover:bg-purple-50 dark:hover:bg-[#1a1130]"
              onClick={() => onEnterGame?.(g.id)}
            >
              <div className="text-sm font-bold">Your game</div>
              <div className="text-xs opacity-70">Tap to resume</div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm opacity-60 text-center py-2">
          No open games yet — create one!
        </p>
      )}
    </section>
  )
}
