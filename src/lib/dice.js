// 5 custom Boggle-style dice. Each die: 6 faces, 2 vowels + 4 consonants.
//
// Top spelling letters (T R S N) are doubled across two different dice so
// common 5-letter words like STARE, HEART, TEARS reliably remain
// spellable even after locks. J/K/Q/X/Z dropped (too rare for a 5-die
// daily). 20 letters total, 11 vowel faces (~37%).
export const DICE = [
  ['A', 'E', 'T', 'R', 'N', 'B'],
  ['I', 'O', 'S', 'T', 'L', 'M'],
  ['E', 'U', 'R', 'N', 'H', 'C'],
  ['A', 'I', 'S', 'P', 'G', 'F'],
  ['E', 'O', 'U', 'D', 'W', 'Y'],
]

export const DIE_COUNT = DICE.length
export const ROLLS_PER_TURN = 3

// Roll the 5 dice using the supplied RNG (() => float in [0, 1)).
// `kept[i] === true` means die i is locked and keeps its previous face.
export function rollDice(prevFaces, kept, rng) {
  return DICE.map((die, i) => {
    if (kept[i] && prevFaces[i] != null) return prevFaces[i]
    const idx = Math.floor(rng() * die.length)
    return die[idx]
  })
}
