import { CATEGORIES, isSpellableFromFaces } from './scoring.js'
import { isValidWord } from './dictionary.js'

// Single source of truth for "can this word be scored in this category?"
// Both SoloGamePage and MultiGamePage call this so the rules can never
// drift between the two surfaces.
//
// Returns { kind: 'ok' } | { kind: 'reject', reason: string } | { kind: 'ask-zero' }.
//   ok        → score the word; caller advances state + shows toast
//   reject    → toast the reason and stop (e.g. dictionary miss, too short)
//   ask-zero  → pivot the cell into "Take a 0?" inline prompt
//
// builderWord is the empty string when no letters are parked yet.
export function evaluateScoreAttempt({
  builderWord,
  builderScore,
  faces,
  categoryId,
  dict,
  dictReady,
}) {
  const cat = CATEGORIES.find(c => c.id === categoryId)
  if (!cat) return { kind: 'reject', reason: 'Unknown category' }

  if (!builderWord) return { kind: 'ask-zero' }

  if (builderWord.length < 3) return { kind: 'reject', reason: 'Words must be at least 3 letters' }
  if (!dictReady) return { kind: 'reject', reason: 'Dictionary still loading…' }
  if (!isValidWord(builderWord, dict)) return { kind: 'reject', reason: `"${builderWord}" isn't in the dictionary` }

  const ctx = { word: builderWord, faces, score: builderScore }
  const fits = cat.validate(ctx) &&
    (categoryId !== 'lexicon' || isSpellableFromFaces(builderWord, faces).usedAll)
  if (!fits) return { kind: 'ask-zero' }

  return { kind: 'ok' }
}
