import { SQLobbyShell, SQLobbyHeader } from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from './AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'
import SoloPlayCard from './SoloPlayCard.jsx'
import MultiplayerCard from './MultiplayerCard.jsx'
import CompletedGamesSection from './CompletedGamesSection.jsx'

// Standard SQ lobby layout: solo card -> multiplayer card -> completed games.
// All three sections always render; per-game data wiring happens inside each
// sub-component.
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
      <MultiplayerCard
        /* TODO pass openGames, myGames, onCreate, onEnterGame from the game's lobby data layer */
      />
      <CompletedGamesSection
        /* TODO pass games (last 10 non-dismissed), onDismiss, onView */
      />
    </SQLobbyShell>
  )
}
