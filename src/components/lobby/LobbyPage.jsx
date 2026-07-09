import { useNavigate } from 'react-router-dom'
import { SQLobbyShell, SQLobbyHeader } from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from './AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'
import SoloPlayCard from './SoloPlayCard.jsx'
import MultiplayerCard from './MultiplayerCard.jsx'
import CompletedGamesSection from './CompletedGamesSection.jsx'
import { useMultiplayerLobby } from '../../hooks/useMultiplayerLobby.js'
import { buildCompletedRow } from '../../lib/completedBanner.js'

export default function LobbyPage({ session, profile, isAdmin }) {
  const navigate = useNavigate()
  const user = session?.user
  const { pendingInvites, sentInvites, pendingRematches, activeGames, completed, openGames, opponents, loading } = useMultiplayerLobby(user?.id)

  const completedGames = completed.map(g => buildCompletedRow(g, user?.id, opponents))

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
        pendingRematches={pendingRematches}
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
