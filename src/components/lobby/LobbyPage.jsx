import { useNavigate } from 'react-router-dom'
import { SQLobbyShell, SQLobbyHeader } from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from './AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'
import SoloPlayCard from './SoloPlayCard.jsx'
import MultiplayerCard from './MultiplayerCard.jsx'
import CompletedGamesSection from './CompletedGamesSection.jsx'
import { useMultiplayerLobby } from '../../hooks/useMultiplayerLobby.js'

export default function LobbyPage({ session, profile, isAdmin }) {
  const navigate = useNavigate()
  const user = session?.user
  const { pendingInvites, sentInvites, activeGames, completed, openGames, opponents, loading } = useMultiplayerLobby(user?.id)

  const completedGames = completed.map(g => {
    // N-player aware: read winners from yahdle_players.is_winner (set by the
    // finalize fn for the whole top-score group), never from the singular
    // invited_user_id — for a 3–4p game that's only the FIRST opponent, so the
    // old code showed the wrong winner and a 1v1 scoreline. Self first, then
    // the rest in seat order.
    const nameFor = (p) => p.user_id === user?.id ? 'You' : (opponents[p.user_id]?.username ?? 'Player')
    const seats = [...(g.yahdle_players ?? [])].sort((a, b) => (a.player_index ?? 0) - (b.player_index ?? 0))
    const ordered = [
      ...seats.filter(p => p.user_id === user?.id),
      ...seats.filter(p => p.user_id !== user?.id),
    ]
    const winners = seats.filter(p => p.is_winner)
    const winnerNames = winners.map(nameFor)
    const iWon = winners.some(p => p.user_id === user?.id)
    let headline
    if (g.closed_reason === 'no_other_players') {
      // Expired before anyone else joined — never started, no score line.
      headline = '🚫 Game closed'
    } else if (g.closed_by_admin) {
      headline = '🛑 Game closed by admin'
    } else if (g.forfeit_user_id) {
      const quitter = seats.find(p => p.user_id === g.forfeit_user_id)
      const quitterName = quitter ? nameFor(quitter) : 'A player'
      headline = winnerNames.length
        ? `🏳️ ${quitterName} forfeited — ${winnerNames.join(' & ')} win${winners.length > 1 ? '' : 's'}!`
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
  })

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
      <SoloPlayCard session={session} />
      <MultiplayerCard
        user={user}
        profile={profile}
        pendingInvites={pendingInvites}
        sentInvites={sentInvites}
        activeGames={activeGames}
        openGames={openGames}
        opponents={opponents}
        loading={loading}
      />
      <CompletedGamesSection
        games={completedGames}
        onView={(id) => navigate(`/multi/${id}`)}
      />
    </SQLobbyShell>
  )
}
