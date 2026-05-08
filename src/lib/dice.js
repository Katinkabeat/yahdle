// 6 custom Boggle-style dice. Each die: 8 faces. 48 face slots total.
//
// 21 letters covered (J/Q/X/Z dropped). 20 vowel faces (~42%). Top
// spelling letters (T R S N L) tripled across different dice so 5- and
// 6-letter words like STARE, HEART, FRIEND, BETTER stay reliably
// spellable after locks. D and M doubled to support common letter pairs.
export const DICE = [
  ['A', 'E', 'O', 'T', 'R', 'N', 'D', 'B'],
  ['E', 'I', 'O', 'T', 'R', 'S', 'H', 'P'],
  ['A', 'E', 'U', 'S', 'L', 'M', 'C', 'Y'],
  ['A', 'I', 'O', 'T', 'S', 'L', 'W', 'F'],
  ['A', 'E', 'I', 'U', 'R', 'N', 'D', 'V'],
  ['E', 'I', 'O', 'U', 'N', 'L', 'M', 'G'],
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
