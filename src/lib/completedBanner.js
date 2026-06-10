// Builds one completed-games lobby row { id, headline, subtitle } from a
// finished yahdle_games row (with its embedded yahdle_players[]).
//
// N-PLAYER AWARE: winners are read from yahdle_players.is_winner — the whole
// top-score group the finalize fn marked — never from the singular
// invited_user_id (for a 3–4p game that's only the FIRST opponent, which is
// why the old 1v1-only banner named the wrong winner and hid the other seats).
//
// Shared by LobbyPage (live) and the dev banner preview so the two can't drift.
export function buildCompletedRow(g, userId, opponents = {}) {
  const nameFor = (p) => p.user_id === userId ? 'You' : (opponents[p.user_id]?.username ?? 'Player')
  const seats = [...(g.yahdle_players ?? [])].sort((a, b) => (a.player_index ?? 0) - (b.player_index ?? 0))
  // Self first, then the rest in seat order — so the scoreline reads "You … · …".
  const ordered = [
    ...seats.filter(p => p.user_id === userId),
    ...seats.filter(p => p.user_id !== userId),
  ]
  const winners = seats.filter(p => p.is_winner)
  const winnerNames = winners.map(nameFor)
  const iWon = winners.some(p => p.user_id === userId)

  let headline
  if (g.closed_reason === 'no_other_players') {
    // Expired before anyone else joined — never started, no score line.
    headline = '🚫 Game closed'
  } else if (g.closed_by_admin) {
    headline = '🛑 Game closed by admin'
  } else if (g.forfeit_user_id) {
    const quitter = seats.find(p => p.user_id === g.forfeit_user_id)
    const quitterName = quitter ? nameFor(quitter) : 'A player'
    // "wins" only for a single third-person winner; "win" for "You" or a group.
    const verb = (winners.length > 1 || iWon) ? 'win' : 'wins'
    headline = winnerNames.length
      ? `🏳️ ${quitterName} forfeited — ${winnerNames.join(' & ')} ${verb}!`
      : `🏳️ ${quitterName} forfeited`
  } else if (winners.length > 1) {
    // Top-score group shares the win (1v1 draw → both win, or N-player tie).
    headline = `🤝 ${winnerNames.join(' & ')} tie for the win!`
  } else if (iWon) {
    headline = '🏆 You win!'
  } else if (winnerNames.length) {
    headline = `🏆 ${winnerNames[0]} wins!`
  } else {
    headline = '🏆 Game finished'
  }

  const subtitle = g.closed_reason === 'no_other_players'
    ? 'Invite expired — this game closed because no other players joined.'
    : ordered.map(p => `${nameFor(p)} ${p.total_score ?? 0}`).join(' · ')
  return { id: g.id, headline, subtitle }
}
