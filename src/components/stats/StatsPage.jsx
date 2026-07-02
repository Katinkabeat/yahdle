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
        <TabButton active={tab === 'today'}   onClick={() => setTab('today')}>🏆 Leaderboard</TabButton>
        <TabButton active={tab === 'mystats'} onClick={() => setTab('mystats')}>📊 My Stats</TabButton>
      </div>

      {tab === 'today'   && <LeaderboardTab userId={session?.user?.id} />}
      {tab === 'mystats' && <MyStatsTab     userId={session?.user?.id} />}
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

// ─── Leaderboard tab ─────────────────────────────────────────
// Four timeframes (day / week / month / all-time). When 'day', a date
// stepper lets you scroll back through past days. For week/month/all-time
// the score shown is each user's SUM across the window.
const TIMEFRAMES = [
  { key: 'day',   label: 'Day'      },
  { key: 'week',  label: 'Week'     },
  { key: 'month', label: 'Month'    },
  { key: 'all',   label: 'All-time' },
]

const WINDOW_LABEL = {
  week:  'This week (Mon–Sun)',
  month: 'This month',
  all:   'All-time, since launch',
}

// Render in UTC because the iso strings represent calendar dates, not
// instants. Without timeZone: 'UTC' a negative-offset client (e.g.
// Atlantic time) would render the prior day.
const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
})

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function formatIso(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return DATE_FMT.format(new Date(Date.UTC(y, m - 1, d)))
}

function LeaderboardTab({ userId }) {
  const [timeframe, setTimeframe] = useState('day')
  const today = useMemo(() => todayInHalifax(), [])
  const [activeDate, setActiveDate] = useState(today)
  const [rows, setRows] = useState(null)
  const [myRank, setMyRank] = useState(null)
  const [error, setError] = useState(null)

  // Keep date anchored to today when leaving the Day tab so re-entering
  // doesn't strand the user on an old date.
  useEffect(() => {
    if (timeframe !== 'day') setActiveDate(today)
  }, [timeframe, today])

  const queryDate = timeframe === 'day' ? activeDate : today

  useEffect(() => {
    let active = true
    setRows(null)
    setMyRank(null)
    setError(null)

    Promise.all([
      supabase.rpc('yahdle_solo_leaderboard', { p_timeframe: timeframe, p_date: queryDate }),
      supabase.rpc('yahdle_solo_my_rank',     { p_timeframe: timeframe, p_date: queryDate }),
    ]).then(([lbRes, rankRes]) => {
      if (!active) return
      if (lbRes.error)   { setError(lbRes.error.message);   return }
      if (rankRes.error) { setError(rankRes.error.message); return }
      setRows(lbRes.data ?? [])
      const rankRow = Array.isArray(rankRes.data) ? rankRes.data[0] : rankRes.data
      setMyRank(rankRow ?? null)
    })

    return () => { active = false }
  }, [timeframe, queryDate])

  const isToday = activeDate === today

  return (
    <div className="space-y-4">
      <SegmentedControl
        options={TIMEFRAMES}
        value={timeframe}
        onChange={setTimeframe}
      />

      {timeframe === 'day' ? (
        <DateStepper
          isoDate={activeDate}
          isToday={isToday}
          onPrev={() => setActiveDate(addDays(activeDate, -1))}
          onNext={() => !isToday && setActiveDate(addDays(activeDate, 1))}
        />
      ) : (
        <p className="text-center text-xs opacity-60 -mt-1">{WINDOW_LABEL[timeframe]}</p>
      )}

      {error && <p className="text-rose-400 text-sm py-6">{error}</p>}
      {!error && rows === null && <p className="italic opacity-70 py-6">Loading…</p>}

      {!error && rows && (
        <Leaderboard
          rows={rows}
          userId={userId}
          myRank={myRank}
          emptyMessage={
            timeframe === 'day'
              ? (isToday ? "No one's played today yet — be the first." : "No scores recorded for this day.")
              : "No scores in this window yet."
          }
        />
      )}
    </div>
  )
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
      {options.map(opt => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold transition-colors ${
            value === opt.key
              ? 'bg-white/15 text-white ring-1 ring-white/30'
              : 'text-white/60 hover:text-white/80'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function DateStepper({ isoDate, isToday, onPrev, onNext }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white/5 border border-white/10">
      <button
        onClick={onPrev}
        aria-label="Previous day"
        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 text-white"
      >
        ‹
      </button>
      <div className="text-sm font-bold flex items-center gap-2">
        {formatIso(isoDate)}
        {isToday && (
          <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-pink-500 text-white">
            Today
          </span>
        )}
      </div>
      <button
        onClick={onNext}
        disabled={isToday}
        aria-label="Next day"
        className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/15 text-white disabled:opacity-30 disabled:hover:bg-white/5 disabled:cursor-not-allowed"
      >
        ›
      </button>
    </div>
  )
}

function Leaderboard({ rows, userId, myRank, emptyMessage }) {
  if (!rows.length) return <Empty>{emptyMessage}</Empty>
  const youInTop = rows.some(r => r.user_id === userId)
  const showMyRankRow = !youInTop && myRank && myRank.rank > 10

  return (
    <ol className="space-y-1.5">
      {rows.map((r, i) => (
        <LeaderboardRow key={r.user_id} row={r} rank={i + 1} isYou={r.user_id === userId} />
      ))}
      {showMyRankRow && (
        <>
          <li className="pt-2 text-center text-[10px] uppercase tracking-wider opacity-50 border-t border-white/10 mt-2">
            your rank
          </li>
          <LeaderboardRow
            row={{ username: 'You', score: myRank.score }}
            rank={myRank.rank}
            isYou
          />
        </>
      )}
    </ol>
  )
}

function LeaderboardRow({ row, rank, isYou }) {
  return (
    <li className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
      isYou ? 'bg-white/15 ring-1 ring-white/30' : 'bg-white/5'
    }`}>
      <div className="w-9 text-center font-display text-sm">#{rank}</div>
      <div className="flex-1 min-w-0 truncate text-sm">
        <span className="font-bold">{row.username || 'anon'}</span>
      </div>
      <div className="font-display text-sm">{row.score} pts</div>
    </li>
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
