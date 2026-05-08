import { SQLobbyShell, SQLobbyHeader } from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from './AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'
import SoloPlayCard from './SoloPlayCard.jsx'

// Yahdle v1 is solo-daily only. Multiplayer + completed-games sections will
// come back when the game gets a multiplayer mode.
export default function LobbyPage({ session, profile, isAdmin }) {
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
      <SoloPlayCard />
    </SQLobbyShell>
  )
}
