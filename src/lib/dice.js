// 6 custom Boggle-style dice. Each die: 6 faces. 36 face slots total.
//
// 21 letters covered (J/Q/X/Z dropped). 15 vowel faces (~42%). Top
// spelling letters (T R S N L) doubled-or-tripled across different dice
// so 5- and 6-letter words like STARE, HEART, FRIEND, BETTER stay
// reliably spellable after locks.
export const DICE = [
  ['A', 'E', 'T', 'R', 'N', 'L'],
  ['I', 'O', 'S', 'T', 'R', 'M'],
  ['A', 'E', 'O', 'P', 'H', 'D'],
  ['A', 'I', 'U', 'S', 'N', 'B'],
  ['E', 'O', 'T', 'L', 'W', 'C'],
  ['E', 'I', 'U', 'Y', 'G', 'F'],
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
