import { SQCompletedGamesCard } from '../../../../rae-side-quest/packages/sq-ui'

// Bottom lobby card — last 10 completed games (most recent first). Always
// shows the 10 most-recent finished games for the current user; no dismiss
// flow. Users have a consistent place to find their recent games.
//
// TODO wire up:
//   - games array (last 10 finished games for the current user, sorted
//     most-recent first). IMPORTANT: order on the parent table column,
//     not on a joined-table column — supabase-js's `referencedTable` order
//     only sorts the embed, not the parent rows, so combined with LIMIT
//     you'd get the wrong 10 rows.
//
//     Each item should expose `headline` + optional `subtitle`. Compute
//     the headline in the data layer using all four branches; never fall
//     back to "highest score wins" because that mislabels admin-closed
//     games and ties.
//
//     Canonical 4-branch headline (replace the field names with your
//     game's columns):
//
//       const headline = g.closed_by_admin
//         ? '🛑 Game closed by admin'
//         : g.forfeit_user_id
//           ? `🏳️ ${forfeiterName} forfeited — ${winnerName} wins!`
//           : g.winner_id
//             ? `🏆 ${winnerName} wins!`
//             : "🤝 It's a tie!"
//
//   - onView(gameId) — navigate to the game's final-board view
const MAX_RENDERED = 10

export default function CompletedGamesSection({
  games = [],
  onView,
}) {
  const visible = games.slice(0, MAX_RENDERED)

  return (
    <SQCompletedGamesCard>
      {visible.length === 0 ? (
        <p className="text-sm opacity-60 text-center py-2">
          No finished games yet.
        </p>
      ) : (
        visible.map((g) => (
          <div
            key={g.id}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-gradient-to-r from-purple-100 to-pink-50 border border-purple-200 dark:from-purple-900/40 dark:to-purple-900/30 dark:border-purple-700"
          >
            <div className="flex-1 min-w-0">
              <div className="font-display text-sm truncate">
                {g.headline ?? '🏆 Game finished'}
              </div>
              {g.subtitle && (
                <div className="text-xs opacity-70 truncate">{g.subtitle}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onView?.(g.id)}
              className="shrink-0 text-xs font-bold underline hover:no-underline"
            >
              View Game
            </button>
          </div>
        ))
      )}
    </SQCompletedGamesCard>
  )
}
