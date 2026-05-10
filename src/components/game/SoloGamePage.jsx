import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  SQBoardShell,
  SQLobbyHeader,
  SQBoardHeader,
} from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'
import { DICE, DIE_COUNT, ROLLS_PER_TURN } from '../../lib/dice.js'
import { CATEGORIES, wordScore } from '../../lib/scoring.js'
import { rngFromSeed } from '../../lib/rng.js'
import { useDictionary } from '../../hooks/useDictionary.js'
import { evaluateScoreAttempt } from '../../lib/scoreValidation.js'
import { supabase } from '../../lib/supabase.js'
import Scorecard from './Scorecard.jsx'
import WordBuilder from './WordBuilder.jsx'
import DiceRack from './DiceRack.jsx'

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
  const { dict, dictReady } = useDictionary()
  // Per-die animation flag — set true when a die is mid-roll, cleared 500ms
  // later. Drives the .die-rolling CSS keyframe in index.css.
  const [animating, setAnimating] = useState(() => new Array(DIE_COUNT).fill(false))

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

  function tapRackDie(i) {
    if (state.faces[i] == null) return
    if (inBuilder[i]) return
    if (state.builder.length >= DIE_COUNT) return
    setState(s => ({
      ...s,
      builder: [...s.builder, { letter: s.faces[i], dieIdx: i }],
    }))
  }

  function tapBuilderLetter(idx) {
    if (swapIdx == null) { setSwapIdx(idx); return }
    if (swapIdx === idx) { setSwapIdx(null); return }
    setState(s => {
      const builder = s.builder.slice()
      ;[builder[swapIdx], builder[idx]] = [builder[idx], builder[swapIdx]]
      return { ...s, builder }
    })
    setSwapIdx(null)
  }

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
  // or pivots the cell into "take a 0?" mode. Validation logic lives in
  // evaluateScoreAttempt so MP shares the same rules.
  function tryScore(categoryId) {
    if (state.scores[categoryId]) return
    const cat = CATEGORIES.find(c => c.id === categoryId)
    if (!cat) return
    const result = evaluateScoreAttempt({
      builderWord, builderScore, faces: state.faces,
      categoryId, dict, dictReady,
    })
    if (result.kind === 'reject') { toast.error(result.reason); return }
    if (result.kind === 'ask-zero') { setZeroAskCategory(categoryId); return }
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

        <Scorecard
          scores={state.scores}
          onTryScore={tryScore}
          disabled={isGameOver}
          zeroAskCategory={zeroAskCategory}
          onConfirmZero={confirmZero}
          onCancelZero={cancelZero}
          builderWord={builderWord}
        />

        {!isGameOver && (
          <WordBuilder
            builder={state.builder}
            rollsThisTurn={state.rollsThisTurn}
            onTapLetter={tapBuilderLetter}
            onRemoveLetter={removeBuilderLetter}
            onClear={clearBuilder}
            swapIdx={swapIdx}
            builderWord={builderWord}
            builderScore={builderScore}
          />
        )}

        {!isGameOver && (
          <DiceRack
            faces={state.faces}
            inBuilder={inBuilder}
            animating={animating}
            rollsThisTurn={state.rollsThisTurn}
            onTapDie={tapRackDie}
            onRoll={handleRoll}
          />
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
