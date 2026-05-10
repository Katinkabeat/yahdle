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
    const oppId = g.created_by === user?.id ? g.invited_user_id : g.created_by
    const opp = opponents[oppId]
    const myPlayer = g.yahdle_players?.find(p => p.user_id === user?.id)
    const oppPlayer = g.yahdle_players?.find(p => p.user_id !== user?.id)
    const oppName = opp?.username ?? 'Opponent'
    const myName = profile?.username ?? 'You'
    let headline
    if (g.closed_by_admin) {
      headline = '🛑 Game closed by admin'
    } else if (g.forfeit_user_id) {
      const forfeiter = g.forfeit_user_id === user?.id ? myName : oppName
      const winner = g.forfeit_user_id === user?.id ? oppName : myName
      headline = `🏳️ ${forfeiter} forfeited — ${winner} wins!`
    } else if (g.is_tie) {
      headline = "🤝 It's a tie!"
    } else if (g.winner_user_id === user?.id) {
      headline = `🏆 You win!`
    } else if (g.winner_user_id) {
      headline = `🏆 ${oppName} wins!`
    } else {
      headline = '🏆 Game finished'
    }
    const subtitle = `You ${myPlayer?.total_score ?? 0} — ${oppName} ${oppPlayer?.total_score ?? 0}`
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
