import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  SQAvatarButton,
  SQAvatarDropdown,
  SQAvatarMenuItem,
} from '../../../../rae-side-quest/packages/sq-ui'

// Avatar button + identity dropdown. Reused on both LobbyPage and GamePage
// so the avatar lives in the same spot across every screen of the game.
//
// Default contents: Stats. Add game-specific items (profile, friends, etc.)
// here per game.
export default function AvatarMenu({ profile }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="relative">
      <SQAvatarButton
        profile={profile}
        ariaExpanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      <SQAvatarDropdown
        open={open}
        onClose={() => setOpen(false)}
        profile={profile}
        align="left"
      >
        <SQAvatarMenuItem
          onClick={() => { setOpen(false); navigate('/stats') }}
        >
          📊 Stats
        </SQAvatarMenuItem>
        {/* TODO add game-specific avatar menu items here */}
      </SQAvatarDropdown>
    </div>
  )
}
