import { useNavigate, useParams } from 'react-router-dom'
import {
  SQBoardShell,
  SQLobbyHeader,
  SQBoardHeader,
} from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'

// Solo play page. Persistent game id so the player can leave and resume.
//
// TODO:
//   - load solo game state by `gameId` (or create-if-missing for fresh starts)
//   - render the Yahdle solo play surface
//   - persist progress on every move so closing the tab is safe
export default function SoloGamePage({ session, profile, isAdmin }) {
  const { gameId } = useParams()
  const navigate = useNavigate()

  return (
    <SQBoardShell
      width="narrow"
      header={
        <SQLobbyHeader
          title="Yahdle"
          avatarSlot={<AvatarMenu profile={profile} />}
          rightSlot={<HeaderRight isAdmin={isAdmin} />}
        />
      }
      subHeader={
        <SQBoardHeader
          backLabel="← Lobby"
          onBackClick={() => navigate('/')}
          centerSlot={null}
          rightSlot={null /* TODO solo-game status, e.g. moves remaining */}
        />
      }
    >
      <div className="py-6">
        <h1 className="font-display text-2xl mb-2">Solo game {gameId}</h1>
        <p className="opacity-80">
          Solo board placeholder — render the Yahdle solo play surface here.
        </p>
      </div>
    </SQBoardShell>
  )
}
