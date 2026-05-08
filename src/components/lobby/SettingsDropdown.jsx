import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  SQDropdown,
  SQSettingsRow,
} from '../../../../rae-side-quest/packages/sq-ui'
import { useTheme } from '../../contexts/ThemeContext.jsx'
import { supabase } from '../../lib/supabase.js'
import HowToPlayModal from '../HowToPlayModal.jsx'

// Cog button with the default settings dropdown. Defaults: theme toggle,
// how-to-play, optional admin panel link, log out. Add game-specific
// rows in the marked TODO slot.
//
// `isAdmin` — when truthy, renders the "🔐 Admin panel" row that
// navigates to /admin. Loaded once in App.jsx and threaded through
// HeaderRight; this component shouldn't query the admins table itself.
export default function SettingsDropdown({ isAdmin = false }) {
  const [open, setOpen] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()
  const { isDark, toggle: toggleTheme } = useTheme()

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-lg leading-none hover:scale-110 transition-transform"
          title="Settings"
          aria-label="Settings"
        >
          ⚙️
        </button>
        <SQDropdown
          open={open}
          onClose={() => setOpen(false)}
          align="right"
          className="text-sm"
        >
          <SQSettingsRow
            label={isDark ? '☀️ Light mode' : '🌙 Dark mode'}
            onClick={() => { toggleTheme(); setOpen(false) }}
          />
          <SQSettingsRow
            label="📖 How to play"
            onClick={() => { setHowToOpen(true); setOpen(false) }}
          />
          {/* TODO add game-specific settings rows here */}
          {isAdmin && (
            <SQSettingsRow
              label="🔐 Admin panel"
              onClick={() => { setOpen(false); navigate('/admin') }}
            />
          )}
          <SQSettingsRow
            label="👋 Log out"
            danger
            onClick={async () => {
              setOpen(false)
              try { await supabase.auth.signOut() } catch {}
              const ret = window.location.pathname + window.location.search
              window.location.replace(`${window.location.origin}/games/?return=${encodeURIComponent(ret)}`)
            }}
          />
        </SQDropdown>
      </div>
      <HowToPlayModal open={howToOpen} onClose={() => setHowToOpen(false)} />
    </>
  )
}
