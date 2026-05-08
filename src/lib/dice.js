// 5 custom Boggle-style dice. Each die has 6 letter faces, balanced so
// every roll has on average 2-3 vowels and at least one consonant. J/Q/X/Z
// are excluded — too punishing for a 5-die daily.
//
// 21 letters covered: A B C D E F G H I K L M N O P R S T U V W Y
// Vowels per die: 2 / 3 / 3 / 3 / 2  (~43% vowel faces overall)
export const DICE = [
  ['A', 'E', 'O', 'R', 'S', 'T'],
  ['A', 'I', 'U', 'N', 'L', 'D'],
  ['E', 'I', 'O', 'M', 'H', 'P'],
  ['A', 'E', 'Y', 'C', 'F', 'G'],
  ['I', 'U', 'B', 'W', 'K', 'V'],
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
