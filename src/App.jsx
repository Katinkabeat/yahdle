import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { useTheme } from './contexts/ThemeContext.jsx'

// Code-split each route so only the page being visited downloads up-front.
const LobbyPage     = lazy(() => import('./components/lobby/LobbyPage.jsx'))
const SoloGamePage  = lazy(() => import('./components/game/SoloGamePage.jsx'))
const MultiGamePage = lazy(() => import('./components/game/MultiGamePage.jsx'))
const StatsPage     = lazy(() => import('./components/stats/StatsPage.jsx'))
const AdminPage     = lazy(() => import('./components/admin/AdminPage.jsx'))

function PageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="font-display text-2xl">Loading…</p>
    </div>
  )
}

export default function App() {
  // Subscribe to theme so re-renders propagate to lazy-loaded pages.
  useTheme()
  const [session, setSession] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)
  // Admin record from the shared `public.admins` table (managed in
  // the SQ hub). null = not an admin. Threaded through HeaderRight
  // so the settings dropdown can show the admin-panel row.
  const [adminRecord, setAdminRecord] = useState(null)
  // Detect password-recovery link from the URL hash synchronously so we can
  // redirect to the SQ hub (which owns the recovery form) before Supabase
  // consumes the hash and swaps it for a session token.
  const [isRecovery] = useState(
    () => window.location.hash.includes('type=recovery')
  )

  useEffect(() => {
    // Safety timeout: if getSession() hangs (e.g. orphaned navigator.locks),
    // fall back to the redirect path after 5 seconds.
    const timeout = setTimeout(() => {
      setSession(s => (s === undefined ? null : s))
    }, 5000)

    supabase.auth.getSession().then(({ data: { session } }) => {
      clearTimeout(timeout)
      setSession(session?.user ? session : null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      clearTimeout(timeout)
      setSession(s?.user ? s : null)
    })
    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  // Load the user's SQ profile once we have a session (used for avatar art etc.).
  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    let cancelled = false
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile(data)
      })
    return () => { cancelled = true }
  }, [session])

  // Load admin record (if any) from the shared admins table.
  useEffect(() => {
    if (!session?.user) { setAdminRecord(null); return }
    let cancelled = false
    supabase
      .from('admins')
      .select('user_id, permissions, is_master')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setAdminRecord(data ?? null)
      })
    return () => { cancelled = true }
  }, [session])

  const isAdmin = !!adminRecord

  // The SQ hub owns the entire auth surface. Redirect logged-out users —
  // and any legacy password-recovery emails — to /games/ which handles login.
  useEffect(() => {
    if (isRecovery) {
      window.location.replace(`${window.location.origin}/games/${window.location.hash}`)
    } else if (session === null) {
      const ret = window.location.pathname + window.location.search
      window.location.replace(`${window.location.origin}/games/?return=${encodeURIComponent(ret)}`)
    }
  }, [session, isRecovery])

  if (session === undefined && !isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="font-display text-2xl">Loading Yahdle 🎲…</p>
      </div>
    )
  }

  if (session === null || isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="font-display text-2xl">Redirecting to login…</p>
      </div>
    )
  }

  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<LobbyPage session={session} profile={profile} isAdmin={isAdmin} />} />
        <Route path="/solo/:gameId"  element={<SoloGamePage  session={session} profile={profile} isAdmin={isAdmin} />} />
        <Route path="/multi/:gameId" element={<MultiGamePage session={session} profile={profile} isAdmin={isAdmin} />} />
        <Route path="/stats" element={<StatsPage session={session} profile={profile} isAdmin={isAdmin} />} />
        <Route path="/admin" element={<AdminPage session={session} profile={profile} isAdmin={isAdmin} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
