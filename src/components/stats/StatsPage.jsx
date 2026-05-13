import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { SQLobbyShell, SQLobbyHeader } from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'
import { supabase } from '../../lib/supabase.js'
import { CATEGORIES } from '../../lib/scoring.js'

function todayInHalifax() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Halifax',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())
}

export default function StatsPage({ session, profile, isAdmin }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState('today')

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

      <div className="flex border-b border-white/10 mb-4">
        <TabButton active={tab === 'today'}   onClick={() => setTab('today')}>📅 Today</TabButton>
        <TabButton active={tab === 'mystats'} onClick={() => setTab('mystats')}>📊 My Stats</TabButton>
      </div>

      {tab === 'today'   && <TodayTab   userId={session?.user?.id} />}
      {tab === 'mystats' && <MyStatsTab userId={session?.user?.id} />}
    </SQLobbyShell>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 px-4 font-display text-sm transition-colors ${
        active
          ? 'text-white border-b-2 border-white'
          : 'text-white/60 hover:text-white/80'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Today tab ───────────────────────────────────────────────
function TodayTab({ userId }) {
  const [rows, setRows]       = useState(null)
  const [error, setError]     = useState(null)
  const today = useMemo(() => todayInHalifax(), [])

  useEffect(() => {
    let active = true
    supabase
      .rpc('yahdle_daily_leaderboard', { p_date: today })
      .then(({ data, error }) => {
        if (!active) return
        if (error) setError(error.message)
        else setRows(data ?? [])
      })
    return () => { active = false }
  }, [today])

  if (error) return <p className="text-rose-400 text-sm py-6">{error}</p>
  if (rows === null) return <p className="italic opacity-70 py-6">Loading…</p>

  const myRow      = rows.find(r => r.user_id === userId)
  const playerCount = rows.length
  const high       = playerCount ? rows[0].score : 0
  const avg        = playerCount
    ? Math.round(rows.reduce((s, r) => s + r.score, 0) / playerCount)
    : 0

  return (
    <div className="space-y-6">
      <Section title="🏆 Today's Leaderboard">
        {playerCount === 0 ? (
          <Empty>No one's played today yet — be the first.</Empty>
        ) : (
          <ol className="space-y-1.5">
            {rows.map((r, i) => (
              <LeaderboardRow key={r.user_id} row={r} rank={i + 1} isYou={r.user_id === userId} />
            ))}
          </ol>
        )}
      </Section>

      {myRow && (
        <Section title="Your Score">
          <div className="flex items-baseline gap-2 px-1">
            <span className="font-display text-3xl">{myRow.score}</span>
            <span className="opacity-60 text-sm">pts</span>
          </div>
        </Section>
      )}

      {playerCount > 1 && (
        <Section title="Score Distribution">
          <Histogram scores={rows.map(r => r.score)} mine={myRow?.score} />
        </Section>
      )}

      <Section title="Quick Stats">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Players" value={playerCount} />
          <Stat label="Average" value={avg} />
          <Stat label="High"    value={high} />
        </div>
      </Section>
    </div>
  )
}

function LeaderboardRow({ row, rank, isYou }) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank
  return (
    <li className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
      isYou ? 'bg-white/15 ring-1 ring-white/30' : 'bg-white/5'
    }`}>
      <div className="w-7 text-center font-display text-sm">{medal}</div>
      <div className="flex-1 min-w-0 truncate text-sm">
        <span className="font-bold">{row.username || 'anon'}</span>
        {isYou && <span className="ml-2 text-[10px] opacity-60">← you</span>}
      </div>
      <div className="font-display text-sm">{row.score} pts</div>
    </li>
  )
}

// Score distribution: 8 buckets across [min..max].
function Histogram({ scores, mine }) {
  if (!scores.length) return null
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const span = Math.max(1, max - min)
  const bucketCount = 8
  const buckets = new Array(bucketCount).fill(0)
  let mineBucket = -1
  for (const s of scores) {
    const idx = Math.min(bucketCount - 1, Math.floor(((s - min) / span) * bucketCount))
    buckets[idx]++
  }
  if (mine != null) {
    mineBucket = Math.min(bucketCount - 1, Math.floor(((mine - min) / span) * bucketCount))
  }
  const peak = Math.max(...buckets, 1)
  return (
    <div className="px-1">
      <div className="flex items-end gap-1 h-24">
        {buckets.map((n, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end">
            <div
              className={`w-full rounded-t ${i === mineBucket ? 'bg-amber-400' : 'bg-white/40'}`}
              style={{ height: `${(n / peak) * 100}%`, minHeight: n ? 4 : 0 }}
              title={`${n} player${n === 1 ? '' : 's'}`}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] opacity-60 mt-1">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}

// ─── My Stats tab (1v1 multiplayer only) ─────────────────────
function MyStatsTab({ userId }) {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    supabase
      .rpc('yahdle_my_mp_stats')
      .then(({ data, error }) => {
        if (!active) return
        if (error) setError(error.message)
        else setStats(Array.isArray(data) ? data[0] : data)
      })
    return () => { active = false }
  }, [userId])

  if (error) return <p className="text-rose-400 text-sm py-6">{error}</p>
  if (!stats) return <p className="italic opacity-70 py-6">Loading…</p>

  const total = stats.games_played ?? 0
  if (total === 0) {
    return <Empty>No multiplayer games yet — invite a friend from the lobby.</Empty>
  }

  const winRate = (stats.wins + stats.losses + stats.ties) > 0
    ? Math.round((stats.wins / (stats.wins + stats.losses + stats.ties)) * 100)
    : 0
  const cats = stats.category_bests || {}

  return (
    <div className="space-y-6">
      <Section title="Multiplayer">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Games played" value={total} />
          <Stat
            label="Win rate"
            value={
              <>
                {winRate}%
                <span className="text-xs opacity-60 ml-1">
                  ({stats.wins}–{stats.losses}{stats.ties ? `–${stats.ties}` : ''})
                </span>
              </>
            }
          />
          <Stat label="Best score"    value={stats.best_score} />
          <Stat label="Average score" value={stats.avg_score}  />
        </div>
      </Section>

      <Section title="Category Bests">
        <div className="grid grid-cols-2 gap-2">
          {CATEGORIES.map(c => (
            <div key={c.id} className="flex items-baseline justify-between px-3 py-2 rounded-lg bg-white/5">
              <div className="text-sm truncate" title={c.desc}>{c.name}</div>
              <div className="font-display text-sm">{cats[c.id] ?? '—'}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

// ─── Shared bits ─────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <section>
      <h3 className="font-display text-xs uppercase tracking-wider opacity-70 mb-2 px-1">{title}</h3>
      {children}
    </section>
  )
}

function Stat({ label, value }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-white/5">
      <div className="text-[10px] uppercase tracking-wider opacity-60">{label}</div>
      <div className="font-display text-lg leading-tight">{value}</div>
    </div>
  )
}

function Empty({ children }) {
  return <p className="text-center opacity-70 text-sm py-8">{children}</p>
}
