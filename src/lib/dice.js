// 6 custom Boggle-style dice. Each die: 8 faces. 48 face slots total.
//
// Concentrated alphabet — only 18 letters covered (F K J Q V X Y Z dropped)
// so each common letter has more placements and rolls land on workable
// combos more often. Top spelling letters T R S N L each appear on 4 of
// the 6 dice. Vowels A E I O U get 4-5 placements. 20 vowel faces
// (~42%). Spice letters (D H M C P B W G) one each.
export const DICE = [
  ['A', 'E', 'I', 'T', 'R', 'N', 'L', 'D'],
  ['A', 'E', 'O', 'T', 'R', 'S', 'N', 'H'],
  ['A', 'I', 'U', 'T', 'S', 'N', 'L', 'M'],
  ['A', 'E', 'O', 'U', 'R', 'S', 'L', 'C'],
  ['E', 'I', 'O', 'U', 'T', 'R', 'P', 'B'],
  ['E', 'I', 'O', 'S', 'N', 'L', 'W', 'G'],
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
