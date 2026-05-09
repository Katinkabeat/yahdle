import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  SQBoardShell,
  SQLobbyHeader,
  SQBoardHeader,
  SQButton,
} from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'
import { DICE, DIE_COUNT, ROLLS_PER_TURN, rollDice } from '../../lib/dice.js'
import { CATEGORIES, wordScore, isSpellableFromFaces, LETTER_VALUES } from '../../lib/scoring.js'
import { rngFromSeed } from '../../lib/rng.js'
import { loadDictionary, isValidWord } from '../../lib/dictionary.js'
import { supabase } from '../../lib/supabase.js'

const TOTAL_TURNS = CATEGORIES.length

function makeInitialState() {
  return {
    turn: 1,
    rollsThisTurn: 0,
    // faces[i] = current face of die i (null before first roll).
    faces: new Array(DIE_COUNT).fill(null),
    // builder = ordered list of dice currently in the word area.
    // A die in the builder is locked (re-rolls skip it) and contributes
    // its letter to the word in builder-order.
    builder: [], // [{ letter, dieIdx }]
    scores: {}, // { categoryId: { word, score } }
  }
}

function storageKey(userId, gameId) {
  return `yahdle:state:${userId}:${gameId}`
}

function loadState(userId, gameId) {
  try {
    const raw = localStorage.getItem(storageKey(userId, gameId))
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function saveState(userId, gameId, state) {
  try {
    localStorage.setItem(storageKey(userId, gameId), JSON.stringify(state))
  } catch {}
}

// Roll dice for (turn, rollNumber). Each (turn, roll, die) triple has its
// own deterministic seed so a player's word-area choices don't shift
// other dice. `skip[i] === true` means die i keeps its current face
// (it's parked in the word area).
function rollForTurn(seedBase, turn, rollNumber, prevFaces, skip) {
  const next = prevFaces.slice()
  for (let i = 0; i < DIE_COUNT; i++) {
    if (skip[i] && prevFaces[i] != null) continue
    const rng = rngFromSeed(`${seedBase}:t${turn}:r${rollNumber}:d${i}`)
    next[i] = DICE[i][Math.floor(rng() * DICE[i].length)]
  }
  return next
}

export default function SoloGamePage({ session, profile, isAdmin }) {
  const { gameId } = useParams() // YMD string, e.g. "2026-05-07"
  const navigate = useNavigate()
  const userId = session.user.id

  // Admin-only seed salt: wiped on a normal day, but the Reset button sets
  // a random value so each reset rolls fresh dice for playtesting. Lives
  // in localStorage so reloads keep the same variant until the next reset.
  const saltKey = `yahdle:salt:${userId}:${gameId}`
  const [resetSalt, setResetSalt] = useState(() => {
    try { return localStorage.getItem(saltKey) || '' } catch { return '' }
  })
  const seedBase = resetSalt
    ? `yahdle:daily:${gameId}:${resetSalt}`
    : `yahdle:daily:${gameId}`

  const [state, setState] = useState(() => loadState(userId, gameId) || makeInitialState())
  const [dictReady, setDictReady] = useState(false)
  const [dict, setDict] = useState(null)
  // Per-die animation flag — set true when a die is mid-roll, cleared 500ms
  // later. Drives the .die-rolling CSS keyframe in index.css.
  const [animating, setAnimating] = useState(() => new Array(DIE_COUNT).fill(false))

  useEffect(() => {
    loadDictionary().then(set => { setDict(set); setDictReady(true) })
  }, [])

  useEffect(() => {
    saveState(userId, gameId, state)
  }, [state, userId, gameId])

  const isGameOver = Object.keys(state.scores).length >= TOTAL_TURNS
  const totalScore = useMemo(
    () => Object.values(state.scores).reduce((sum, s) => sum + s.score, 0),
    [state.scores]
  )

  // Record the daily completion in Supabase so it counts toward the streak.
  // Upsert so admin Reset → replay doesn't error; gameId is the Atlantic
  // YMD passed in via the route param.
  useEffect(() => {
    if (!isGameOver) return
    let active = true
    const recorded = sessionStorage.getItem(`yahdle:recorded:${userId}:${gameId}`)
    if (recorded) return
    supabase
      .from('yahdle_solo_results')
      .upsert(
        { user_id: userId, play_date: gameId, score: totalScore },
        { onConflict: 'user_id,play_date' }
      )
      .then(({ error }) => {
        if (!active) return
        if (error) {
          console.error('[yahdle] failed to record solo result', error)
          return
        }
        try { sessionStorage.setItem(`yahdle:recorded:${userId}:${gameId}`, '1') } catch {}
      })
    return () => { active = false }
  }, [isGameOver, userId, gameId, totalScore])

  const builderWord = state.builder.map(b => b.letter).join('')
  const builderScore = wordScore(builderWord)

  // Lookup: which dice are currently in the word area (skip on re-roll).
  const inBuilder = useMemo(() => {
    const set = new Set(state.builder.map(b => b.dieIdx))
    return new Array(DIE_COUNT).fill(false).map((_, i) => set.has(i))
  }, [state.builder])

  // Selected-for-swap state: which builder letter is highlighted, awaiting
  // a second tap on another letter to swap with. null = nothing selected.
  const [swapIdx, setSwapIdx] = useState(null)

  // Inline-confirm state: which category is asking for a 0.
  const [zeroAskCategory, setZeroAskCategory] = useState(null)

  function handleRoll() {
    if (isGameOver) return
    if (state.rollsThisTurn >= ROLLS_PER_TURN) return
    // If every die is parked in the word area there's nothing to roll.
    if (inBuilder.every(Boolean)) return
    const nextRollNum = state.rollsThisTurn + 1
    const newFaces = rollForTurn(seedBase, state.turn, nextRollNum, state.faces, inBuilder)
    // Animate only the dice that actually re-rolled.
    setAnimating(inBuilder.map(b => !b))
    setTimeout(() => setAnimating(new Array(DIE_COUNT).fill(false)), 500)
    setState(s => ({
      ...s,
      faces: newFaces,
      rollsThisTurn: nextRollNum,
    }))
  }

  // Tap a die in the rack → move it (and its letter) into the word area.
  function tapRackDie(i) {
    if (state.faces[i] == null) return
    if (inBuilder[i]) return
    if (state.builder.length >= DIE_COUNT) return
    setState(s => ({
      ...s,
      builder: [...s.builder, { letter: s.faces[i], dieIdx: i }],
    }))
  }

  // Tap a letter in the word area. Either selects it for swap, or
  // completes a pending swap.
  function tapBuilderLetter(idx) {
    if (swapIdx == null) {
      setSwapIdx(idx)
      return
    }
    if (swapIdx === idx) {
      setSwapIdx(null)
      return
    }
    setState(s => {
      const builder = s.builder.slice()
      ;[builder[swapIdx], builder[idx]] = [builder[idx], builder[swapIdx]]
      return { ...s, builder }
    })
    setSwapIdx(null)
  }

  // Remove a letter from the word area → its die returns to the rack at
  // its current face. Sits there until the next Re-roll.
  function removeBuilderLetter(idx) {
    setState(s => ({
      ...s,
      builder: s.builder.slice(0, idx).concat(s.builder.slice(idx + 1)),
    }))
    setSwapIdx(null)
  }

  function clearBuilder() {
    setState(s => ({ ...s, builder: [] }))
    setSwapIdx(null)
  }

  function applyScore(categoryId, word, score) {
    setState(s => ({
      ...s,
      scores: { ...s.scores, [categoryId]: { word, score } },
      turn: s.turn + 1,
      rollsThisTurn: 0,
      faces: new Array(DIE_COUNT).fill(null),
      builder: [],
    }))
    setZeroAskCategory(null)
    setSwapIdx(null)
  }

  // Tap on a category cell. Either scores the current word (if it fits)
  // or pivots the cell into "take a 0?" mode.
  function tryScore(categoryId) {
    if (state.scores[categoryId]) return
    const cat = CATEGORIES.find(c => c.id === categoryId)
    if (!cat) return

    // No word → ask for 0 inline
    if (!builderWord) {
      setZeroAskCategory(categoryId)
      return
    }
    if (builderWord.length < 3) {
      toast.error('Words must be at least 3 letters')
      return
    }
    if (!dictReady) {
      toast.error('Dictionary still loading…')
      return
    }
    if (!isValidWord(builderWord, dict)) {
      toast.error(`"${builderWord}" isn't in the dictionary`)
      return
    }
    const ctx = { word: builderWord, faces: state.faces, score: builderScore }
    const fits = cat.validate(ctx) &&
      (categoryId !== 'lexicon' || isSpellableFromFaces(builderWord, state.faces).usedAll)
    if (!fits) {
      // Word doesn't fit this category → inline "take a 0?" prompt
      setZeroAskCategory(categoryId)
      return
    }
    applyScore(categoryId, builderWord, builderScore)
    toast.success(`+${builderScore} • ${cat.name}`)
  }

  function confirmZero(categoryId) {
    if (state.scores[categoryId]) return
    applyScore(categoryId, '', 0)
  }

  function cancelZero() {
    setZeroAskCategory(null)
  }

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
          centerSlot={
            <span className="text-sm opacity-80">
              {isGameOver ? `Final: ${totalScore}` : `Turn ${state.turn}/${TOTAL_TURNS} • ${totalScore} pts`}
            </span>
          }
          rightSlot={
            isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  if (!confirm('Reset with fresh dice? Progress wipes too.')) return
                  const newSalt = Math.random().toString(36).slice(2, 10)
                  try {
                    localStorage.setItem(saltKey, newSalt)
                    localStorage.removeItem(storageKey(userId, gameId))
                  } catch {}
                  setResetSalt(newSalt)
                  setState(makeInitialState())
                }}
                className="text-xs font-bold px-2 py-1 rounded border border-amber-400/60 text-amber-300 hover:bg-amber-400/10"
                title="Admin-only: wipe save and roll a fresh daily variant"
              >
                ↻ Reset
              </button>
            ) : null
          }
        />
      }
    >
      <div className="py-4 px-2 space-y-4">

        {/* Scorecard */}
        <div className="card p-3">
          <h2 className="text-xs uppercase tracking-wide opacity-70 text-center mb-2">Scorecard</h2>
          <div className="grid grid-cols-2 gap-1.5">
            {CATEGORIES.map(cat => {
              const filled = state.scores[cat.id]
              const asking = zeroAskCategory === cat.id

              if (asking && !filled) {
                const reason = builderWord
                  ? `${builderWord} doesn’t fit here.`
                  : `No word yet.`
                return (
                  <div
                    key={cat.id}
                    className="rounded-lg px-2 py-1.5 border border-amber-400/60 bg-amber-900/30 text-xs"
                  >
                    <div className="font-bold mb-1">{cat.name}</div>
                    <div className="text-amber-200 mb-1.5 text-[11px]">
                      {reason} Take a 0?
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => confirmZero(cat.id)}
                        className="flex-1 rounded bg-amber-400 text-amber-950 font-bold py-1"
                      >
                        Take 0
                      </button>
                      <button
                        type="button"
                        onClick={cancelZero}
                        className="flex-1 rounded border border-white/30 text-white py-1"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )
              }

              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => tryScore(cat.id)}
                  disabled={!!filled || isGameOver}
                  className={`text-left rounded-lg px-2 py-1.5 border text-xs transition ${
                    filled
                      ? 'border-green-600/40 bg-green-900/20 cursor-default'
                      : 'border-white/10 hover:border-wordy-500 hover:bg-wordy-700/20'
                  }`}
                >
                  <div className="font-bold">{cat.name}</div>
                  {filled ? (
                    <div className="text-green-400 mt-0.5">
                      {filled.word ? `${filled.word} — ${filled.score} pts` : '— 0 pts'}
                    </div>
                  ) : (
                    <div className="opacity-60 mt-0.5">{cat.desc}</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Word builder — always visible so layout doesn't shift */}
        {!isGameOver && (
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide opacity-70">Your word</div>
              {state.builder.length > 1 && (
                <span className="text-[10px] opacity-50">tap two letters to swap</span>
              )}
            </div>
            <div className="min-h-[44px] flex flex-wrap items-center gap-1.5 mb-2">
              {state.builder.length === 0 ? (
                <span className="text-sm opacity-50 self-center">
                  {state.rollsThisTurn === 0
                    ? 'Roll the dice to start'
                    : 'Tap dice below to add letters here'}
                </span>
              ) : (
                state.builder.map((b, i) => {
                  const selected = swapIdx === i
                  const value = LETTER_VALUES[b.letter]
                  return (
                    <div key={i} className="relative">
                      <button
                        type="button"
                        onClick={() => tapBuilderLetter(i)}
                        className={`relative font-display text-xl rounded px-2 py-1 min-w-[36px] border-2 transition ${
                          selected
                            ? 'border-amber-400 bg-amber-700 text-amber-100'
                            : 'border-transparent bg-wordy-700 text-white'
                        }`}
                      >
                        <span className="leading-none">{b.letter}</span>
                        {value != null && (
                          <span className="absolute bottom-0.5 right-1 text-[9px] font-bold leading-none opacity-70">
                            {value}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBuilderLetter(i)}
                        aria-label="Remove letter"
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-wordy-900 border border-white/30 text-[10px] leading-none flex items-center justify-center hover:bg-red-700"
                      >
                        ×
                      </button>
                    </div>
                  )
                })
              )}
            </div>
            <div className="flex justify-between items-center text-xs opacity-70">
              <span>{builderWord ? `${builderWord} • ${builderScore} pts` : ' '}</span>
              {state.builder.length > 0 && (
                <button onClick={clearBuilder} className="underline">clear</button>
              )}
            </div>
          </div>
        )}

        {/* Rack + Roll button. Dice in the word area show as faded
            placeholders so the rack keeps a stable 6-slot layout. */}
        {!isGameOver && (
          <div className="card p-3">
            <div className="text-xs uppercase tracking-wide opacity-70 mb-2 text-center">
              {state.rollsThisTurn === 0
                ? 'Roll the dice'
                : 'Tap a die to move it into your word'}
            </div>
            <div className="flex justify-center gap-1.5 mb-3">
              {state.faces.map((face, i) => {
                const empty = face == null
                const parked = inBuilder[i]
                const isRolling = animating[i]
                const value = face ? LETTER_VALUES[face] : null
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => empty || parked ? null : tapRackDie(i)}
                    disabled={empty || parked}
                    style={{ perspective: '400px' }}
                    className={`relative w-11 h-11 rounded-lg font-display text-xl flex items-center justify-center border-2 ${
                      isRolling ? 'die-rolling' : ''
                    } ${
                      empty
                        ? 'border-dashed border-white/20 opacity-40'
                        : parked
                          ? 'border-dashed border-amber-400/40 opacity-30'
                          : 'border-white/20 bg-wordy-900/40 hover:border-wordy-400'
                    }`}
                  >
                    <span className="leading-none">{parked ? '·' : face ?? '·'}</span>
                    {value != null && !parked && (
                      <span className="absolute bottom-0.5 right-1 text-[9px] font-bold leading-none opacity-70">
                        {value}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-center gap-3 min-h-[44px]">
              <SQButton
                variant="primary"
                onClick={handleRoll}
                disabled={
                  state.rollsThisTurn >= ROLLS_PER_TURN ||
                  inBuilder.every(Boolean)
                }
              >
                {state.rollsThisTurn === 0 ? 'Roll' : 'Re-roll'}
              </SQButton>
              <span className="text-xs opacity-70 whitespace-nowrap">
                Roll {Math.min(state.rollsThisTurn + 1, ROLLS_PER_TURN)}/{ROLLS_PER_TURN}
              </span>
            </div>
          </div>
        )}

        {isGameOver && (
          <div className="card p-4 text-center">
            <h2 className="font-display text-2xl mb-2">Done!</h2>
            <p className="text-3xl font-bold mb-1">{totalScore}</p>
            <p className="text-sm opacity-70">Come back tomorrow for a new puzzle.</p>
          </div>
        )}

      </div>
    </SQBoardShell>
  )
}
