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

const TOTAL_TURNS = CATEGORIES.length

function makeInitialState() {
  return {
    turn: 1,
    rollsThisTurn: 0,
    doneRolling: false, // true → spelling phase: tap = add to word, no more rolls/locks
    faces: new Array(DIE_COUNT).fill(null),
    kept: new Array(DIE_COUNT).fill(false),
    used: new Array(DIE_COUNT).fill(false), // dice consumed by current word builder
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
// own deterministic seed so unlock decisions don't shift other dice.
function rollForTurn(seedBase, turn, rollNumber, prevFaces, kept) {
  const next = prevFaces.slice()
  for (let i = 0; i < DIE_COUNT; i++) {
    if (kept[i] && prevFaces[i] != null) continue
    const rng = rngFromSeed(`${seedBase}:t${turn}:r${rollNumber}:d${i}`)
    next[i] = DICE[i][Math.floor(rng() * DICE[i].length)]
  }
  return next
}

export default function SoloGamePage({ session, profile, isAdmin }) {
  const { gameId } = useParams() // YMD string, e.g. "2026-05-07"
  const navigate = useNavigate()
  const userId = session.user.id
  const seedBase = `yahdle:daily:${gameId}`

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

  const builderWord = state.builder.map(b => b.letter).join('')
  const builderScore = wordScore(builderWord)

  function handleRoll() {
    if (isGameOver) return
    if (state.doneRolling) return
    if (state.rollsThisTurn >= ROLLS_PER_TURN) return
    const nextRollNum = state.rollsThisTurn + 1
    const kept = state.rollsThisTurn === 0 ? new Array(DIE_COUNT).fill(false) : state.kept
    const newFaces = rollForTurn(seedBase, state.turn, nextRollNum, state.faces, kept)
    // Trigger the tumble animation only on dice that are actually re-rolling.
    setAnimating(kept.map(k => !k))
    setTimeout(() => setAnimating(new Array(DIE_COUNT).fill(false)), 500)
    setState(s => ({
      ...s,
      faces: newFaces,
      rollsThisTurn: nextRollNum,
      doneRolling: nextRollNum >= ROLLS_PER_TURN,
      kept: nextRollNum === 1 ? new Array(DIE_COUNT).fill(false) : s.kept,
      used: new Array(DIE_COUNT).fill(false),
      builder: [],
    }))
  }

  function handleDoneRolling() {
    if (state.rollsThisTurn === 0) return
    setState(s => ({ ...s, doneRolling: true }))
  }

  // In rolling phase, tapping a die toggles its lock. In spelling phase,
  // tapping adds the die's letter to the word builder (one-shot per die).
  function tapDie(i) {
    if (state.rollsThisTurn === 0) return
    if (state.faces[i] == null) return
    if (!state.doneRolling) {
      // Locking is pointless on the very last roll, but harmless — disable on UI side instead.
      setState(s => {
        const kept = s.kept.slice()
        kept[i] = !kept[i]
        return { ...s, kept }
      })
      return
    }
    // Spelling phase
    if (state.used[i]) return
    if (state.builder.length >= DIE_COUNT) return
    setState(s => {
      const used = s.used.slice()
      used[i] = true
      return { ...s, used, builder: [...s.builder, { letter: s.faces[i], dieIdx: i }] }
    })
  }

  function popLetter(builderIdx) {
    setState(s => {
      const removed = s.builder[builderIdx]
      if (!removed) return s
      const used = s.used.slice()
      used[removed.dieIdx] = false
      const builder = s.builder.slice(0, builderIdx).concat(s.builder.slice(builderIdx + 1))
      return { ...s, used, builder }
    })
  }

  function clearBuilder() {
    setState(s => ({ ...s, builder: [], used: new Array(DIE_COUNT).fill(false) }))
  }

  // Inline-confirm state: which category is asking the player to take a 0.
  // null = no pending confirm. The cell itself renders the Yes/No prompt.
  const [zeroAskCategory, setZeroAskCategory] = useState(null)

  function applyScore(categoryId, word, score) {
    setState(s => ({
      ...s,
      scores: { ...s.scores, [categoryId]: { word, score } },
      turn: s.turn + 1,
      rollsThisTurn: 0,
      doneRolling: false,
      faces: new Array(DIE_COUNT).fill(null),
      kept: new Array(DIE_COUNT).fill(false),
      used: new Array(DIE_COUNT).fill(false),
      builder: [],
    }))
    setZeroAskCategory(null)
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
                  if (!confirm('Reset today’s game? Your progress will be lost.')) return
                  localStorage.removeItem(storageKey(userId, gameId))
                  setState(makeInitialState())
                }}
                className="text-xs font-bold px-2 py-1 rounded border border-amber-400/60 text-amber-300 hover:bg-amber-400/10"
                title="Admin-only: wipe today's saved game"
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
            <div className="text-xs uppercase tracking-wide opacity-70 mb-2">Your word</div>
            <div className="min-h-[40px] flex flex-wrap gap-1.5 mb-2">
              {state.builder.length === 0 ? (
                <span className="text-sm opacity-50 self-center">
                  {state.doneRolling
                    ? 'Tap dice below to build a word'
                    : state.rollsThisTurn === 0
                      ? 'Roll the dice to start'
                      : 'Lock keepers, then tap "Done rolling"'}
                </span>
              ) : (
                state.builder.map((b, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => popLetter(i)}
                    className="font-display text-xl bg-wordy-700 text-white rounded px-2 py-1 min-w-[32px]"
                    title="Remove"
                  >
                    {b.letter}
                  </button>
                ))
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

        {/* Dice + roll/spell controls */}
        {!isGameOver && (
          <div className="card p-3">
            <div className="text-xs uppercase tracking-wide opacity-70 mb-2 text-center">
              {state.rollsThisTurn === 0
                ? 'Roll the dice'
                : state.doneRolling
                  ? 'Tap dice to spell a word'
                  : 'Tap dice to lock — they\'ll keep their letter on re-roll'}
            </div>
            <div className="flex justify-center gap-1.5 mb-3">
              {state.faces.map((face, i) => {
                const locked = state.kept[i]
                const used = state.used[i]
                const empty = face == null
                const inRollPhase = !state.doneRolling
                const isRolling = animating[i]
                const value = face ? LETTER_VALUES[face] : null
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => empty ? null : tapDie(i)}
                    disabled={empty || (state.doneRolling && used)}
                    style={{ perspective: '400px' }}
                    className={`relative w-11 h-11 rounded-lg font-display text-xl flex items-center justify-center border-2 ${
                      isRolling ? 'die-rolling' : ''
                    } ${
                      empty
                        ? 'border-dashed border-white/20 opacity-40'
                        : used
                          ? 'border-white/10 opacity-30'
                          : locked && inRollPhase
                            ? 'border-amber-400 bg-amber-900/40 text-amber-200 shadow-[0_0_12px_rgba(212,160,84,0.35)]'
                            : 'border-white/20 bg-wordy-900/40 hover:border-wordy-400'
                    }`}
                  >
                    <span className="leading-none">{face ?? '·'}</span>
                    {value != null && (
                      <span className="absolute bottom-0.5 right-1 text-[9px] font-bold leading-none opacity-70">
                        {value}
                      </span>
                    )}
                    {locked && inRollPhase && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 border-2 border-bg" />
                    )}
                  </button>
                )
              })}
            </div>
            {/* Action row — always rendered at the same height so the dice
                card doesn't shrink when buttons go away. */}
            <div className="flex items-center justify-center gap-3 min-h-[44px]">
              {!state.doneRolling ? (
                <>
                  <SQButton
                    variant="primary"
                    onClick={handleRoll}
                    disabled={state.rollsThisTurn >= ROLLS_PER_TURN}
                  >
                    {state.rollsThisTurn === 0 ? 'Roll' : 'Re-roll'}
                  </SQButton>
                  <SQButton
                    variant="secondary"
                    onClick={handleDoneRolling}
                    disabled={state.rollsThisTurn === 0}
                  >
                    Done rolling
                  </SQButton>
                  <span className="text-xs opacity-70 whitespace-nowrap">
                    Roll {Math.min(state.rollsThisTurn + 1, ROLLS_PER_TURN)}/{ROLLS_PER_TURN}
                  </span>
                </>
              ) : (
                <span className="text-xs opacity-70 text-center">
                  Build your word, then tap a category to score.
                </span>
              )}
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
