// ────────────────────────────────────────────────────────────
//  ThemeContext — light / dark toggle, persisted in localStorage
//  under `sq-theme` (shared across all SideQuest apps via same
//  origin, so toggling in one game updates all of them).
//
//  The class flip happens on <html>, so all `.dark .foo` global
//  overrides in index.css fire correctly.
// ────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'sq-theme'
const LEGACY_KEYS = ['wordy-theme', 'rungles-theme', 'snibble-theme', 'yahdle-theme']
const ThemeContext = createContext({ theme: 'light', isDark: false, toggle: () => {} })

function readInitial() {
  try {
    let stored = localStorage.getItem(STORAGE_KEY)
    if (stored == null) {
      for (const k of LEGACY_KEYS) {
        const lv = localStorage.getItem(k)
        if (lv != null) { stored = lv; break }
      }
    }
    return stored === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitial)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
  }, [theme])

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setTheme(e.newValue === 'dark' ? 'dark' : 'light')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
