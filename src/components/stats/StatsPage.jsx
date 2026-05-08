import { useNavigate } from 'react-router-dom'
import { SQLobbyShell, SQLobbyHeader } from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'

// Stats route — placeholder. Each game has its own stats; fill in the
// per-game numbers, charts, history, etc. as the game develops.
export default function StatsPage({ session, profile, isAdmin }) {
  const navigate = useNavigate()

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
      <button
        onClick={() => navigate('/')}
        className="text-sm opacity-80 hover:opacity-100 self-start"
      >
        ← Back to lobby
      </button>
      <h1 className="font-display text-3xl">Your stats</h1>
      <p className="opacity-80">
        Stats placeholder — wire up the per-game numbers, charts, and history here.
      </p>
      {/* TODO add Yahdle-specific stats components */}
    </SQLobbyShell>
  )
}
