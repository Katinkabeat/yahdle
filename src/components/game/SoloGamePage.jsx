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
import { CATEGORIES, wordScore, isSpellableFromFaces } from '../../lib/scoring.js'
import { rngFromSeed } from '../../lib/rng.js'
import { loadDictionary, isValidWord } from '../../lib/dictionary.js'

const TOTAL_TURNS = CATEGORIES.length

function makeInitialState() {
  return {
    turn: 1,
    rollsThisTurn: 0,
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
    if (state.rollsThisTurn >= ROLLS_PER_TURN) {
      toast.error('No rolls left this turn — score a category')
      return
    }
    const nextRollNum = state.rollsThisTurn + 1
    // Rolling re-rolls all unlocked dice. The first roll of a turn ignores
    // `kept` (everything is fresh). After roll 1, kept[] is honored.
    const kept = state.rollsThisTurn === 0 ? new Array(DIE_COUNT).fill(false) : state.kept
    const newFaces = rollForTurn(seedBase, state.turn, nextRollNum, state.faces, kept)
    setState(s => ({
      ...s,
      faces: newFaces,
      rollsThisTurn: nextRollNum,
      kept: nextRollNum === 0 ? new Array(DIE_COUNT).fill(false) : s.kept,
      // Reset builder when dice change (faces changed → previous word is stale)
      used: new Array(DIE_COUNT).fill(false),
      builder: [],
    }))
  }

  function toggleLock(i) {
    if (state.rollsThisTurn === 0) return // can't lock before rolling
    if (state.rollsThisTurn >= ROLLS_PER_TURN) return // no point locking, no more rolls
    setState(s => {
      const kept = s.kept.slice()
      kept[i] = !kept[i]
      return { ...s, kept }
    })
  }

  function tapDie(i) {
    if (state.rollsThisTurn === 0) return
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

  function tryScore(categoryId) {
    if (state.scores[categoryId]) {
      toast.error('Already filled')
      return
    }
    if (!builderWord) {
      toast.error('Build a word from the dice first')
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
    const cat = CATEGORIES.find(c => c.id === categoryId)
    if (!cat) return
    const ctx = { word: builderWord, faces: state.faces, score: builderScore }
    if (!cat.validate(ctx)) {
      toast.error(`"${builderWord}" doesn't fit ${cat.name}`)
      return
    }
    // Lexicon requires using all 5 dice — extra check
    if (categoryId === 'lexicon' && !isSpellableFromFaces(builderWord, state.faces).usedAll) {
      toast.error('Lexicon needs all 5 dice')
      return
    }
    // Score the category. Move to next turn.
    const nextTurn = state.turn + 1
    setState(s => ({
      ...s,
      scores: { ...s.scores, [categoryId]: { word: builderWord, score: builderScore } },
      turn: nextTurn,
      rollsThisTurn: 0,
      faces: new Array(DIE_COUNT).fill(null),
      kept: new Array(DIE_COUNT).fill(false),
      used: new Array(DIE_COUNT).fill(false),
      builder: [],
    }))
    toast.success(`+${builderScore} • ${cat.name}`)
  }

  function scoreZero(categoryId) {
    if (state.scores[categoryId]) return
    if (!confirm(`Take a 0 in ${CATEGORIES.find(c => c.id === categoryId).name}?`)) return
    setState(s => ({
      ...s,
      scores: { ...s.scores, [categoryId]: { word: '', score: 0 } },
      turn: s.turn + 1,
      rollsThisTurn: 0,
      faces: new Array(DIE_COUNT).fill(null),
      kept: new Array(DIE_COUNT).fill(false),
      used: new Array(DIE_COUNT).fill(false),
      builder: [],
    }))
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

        {/* Word builder */}
        {!isGameOver && (
          <div className="card p-3">
            <div className="text-xs uppercase tracking-wide opacity-70 mb-2">Your word</div>
            <div className="min-h-[40px] flex flex-wrap gap-1.5 mb-2">
              {state.builder.length === 0 ? (
                <span className="text-sm opacity-50 self-center">Tap dice below to build a word</span>
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

        {/* Dice + roll */}
        {!isGameOver && (
          <div className="card p-3">
            <div className="flex justify-center gap-2 mb-3">
              {state.faces.map((face, i) => {
                const locked = state.kept[i]
                const used = state.used[i]
                const empty = face == null
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => empty ? null : tapDie(i)}
                    onDoubleClick={() => empty ? null : toggleLock(i)}
                    disabled={empty || used}
                    className={`relative w-12 h-12 rounded-lg font-display text-xl flex items-center justify-center border-2 transition ${
                      empty
                        ? 'border-dashed border-white/20 opacity-40'
                        : used
                          ? 'border-white/10 opacity-30'
                          : locked
                            ? 'border-amber-400 bg-amber-900/40 text-amber-200 shadow-[0_0_12px_rgba(212,160,84,0.35)]'
                            : 'border-white/20 bg-wordy-900/40 hover:border-wordy-400'
                    }`}
                  >
                    {face ?? '·'}
                    {locked && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 border-2 border-bg" />
                    )}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-center gap-3">
              <SQButton variant="primary" onClick={handleRoll} disabled={state.rollsThisTurn >= ROLLS_PER_TURN}>
                {state.rollsThisTurn === 0 ? 'Roll' : 'Re-roll'}
              </SQButton>
              <span className="text-xs opacity-70">
                Roll {Math.min(state.rollsThisTurn + 1, ROLLS_PER_TURN)} of {ROLLS_PER_TURN}
              </span>
            </div>
            {state.rollsThisTurn > 0 && state.rollsThisTurn < ROLLS_PER_TURN && (
              <p className="text-[10px] text-center opacity-50 mt-2">double-tap a die to lock it</p>
            )}
          </div>
        )}

        {!isGameOver && Object.keys(state.scores).length < TOTAL_TURNS && (
          <details className="text-xs opacity-70">
            <summary className="cursor-pointer">Stuck? Take a 0 in a category</summary>
            <div className="grid grid-cols-2 gap-1 mt-2">
              {CATEGORIES.filter(c => !state.scores[c.id]).map(cat => (
                <button key={cat.id} onClick={() => scoreZero(cat.id)} className="underline text-left">
                  0 → {cat.name}
                </button>
              ))}
            </div>
          </details>
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
