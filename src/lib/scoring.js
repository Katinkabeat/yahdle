// Scrabble letter values + category validators.
// Word score = sum of letter values (no length bonuses, no multipliers).

export const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
}

export const VOWELS = new Set(['A', 'E', 'I', 'O', 'U'])

export function wordScore(word) {
  let total = 0
  for (const ch of word.toUpperCase()) total += LETTER_VALUES[ch] ?? 0
  return total
}

function vowelCount(word) {
  let n = 0
  for (const ch of word.toUpperCase()) if (VOWELS.has(ch)) n++
  return n
}

function hasRepeatedLetter(word) {
  const seen = new Set()
  for (const ch of word.toUpperCase()) {
    if (seen.has(ch)) return true
    seen.add(ch)
  }
  return false
}

function allUnique(word) {
  return !hasRepeatedLetter(word)
}

// Verify the word can actually be spelled from `faces` (each die used at most once).
// faces is the 5-letter dice roll. The word must be ≤ 5 letters and each letter
// must consume a distinct die that shows that letter. "Lexicon" requires using all 5.
export function isSpellableFromFaces(word, faces) {
  if (!word || word.length > faces.length) return { ok: false, usedAll: false }
  const w = word.toUpperCase().split('')
  const remaining = faces.map(f => f.toUpperCase())
  const used = new Array(faces.length).fill(false)
  for (const ch of w) {
    const idx = remaining.findIndex((f, i) => !used[i] && f === ch)
    if (idx === -1) return { ok: false, usedAll: false }
    used[idx] = true
  }
  return { ok: true, usedAll: used.every(Boolean) }
}

// Twelve scorecard categories (locked 2026-05-07). Each validator receives
// { word, faces, score } and returns true if the word qualifies.
export const CATEGORIES = [
  {
    id: 'three',
    name: '3-Letter',
    desc: 'any 3-letter word',
    validate: ({ word }) => word.length === 3,
  },
  {
    id: 'four',
    name: '4-Letter',
    desc: 'any 4-letter word',
    validate: ({ word }) => word.length === 4,
  },
  {
    id: 'lexicon',
    name: 'Lexicon',
    desc: 'all dice used',
    validate: ({ word, faces }) => isSpellableFromFaces(word, faces).usedAll,
  },
  {
    id: 'double',
    name: 'Double Up',
    desc: 'repeated letter',
    validate: ({ word }) => hasRepeatedLetter(word),
  },
  {
    id: 'vowels',
    name: 'Vowel Heavy',
    desc: '3+ vowels',
    validate: ({ word }) => vowelCount(word) >= 3,
  },
  {
    id: 'consonants',
    name: 'Consonant Heavy',
    desc: '4+ consonants',
    validate: ({ word }) => word.length - vowelCount(word) >= 4,
  },
  {
    id: 'high',
    name: 'High Value',
    desc: '≥10 pts',
    validate: ({ score }) => score >= 10,
  },
  {
    id: 'low',
    name: 'Low Ball',
    desc: '≤4 pts',
    validate: ({ score }) => score <= 4,
  },
  {
    id: 'bookends',
    name: 'Bookends',
    desc: 'same start & end letter',
    validate: ({ word }) => word.length >= 2 && word[0].toUpperCase() === word[word.length - 1].toUpperCase(),
  },
  {
    id: 'unique',
    name: 'No Repeats',
    desc: 'all unique letters',
    validate: ({ word }) => allUnique(word),
  },
  {
    id: 'longshot',
    name: 'Long Shot',
    desc: '5-letter, ≥15 pts',
    validate: ({ word, score }) => word.length === 5 && score >= 15,
  },
  {
    id: 'wild',
    name: 'Wild Card',
    desc: 'any word',
    validate: () => true,
  },
]
