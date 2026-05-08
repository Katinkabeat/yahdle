# Yahdle — Admin Quick Guide

Things only admins (and other testers) see or care about.

## Where it lives

- **Local dev:** `npm run dev:all` from `rae-side-quest`, then visit `localhost:8080/yahdle/`. Lobby + login flow at `/games/`. Login carries through to Yahdle automatically.
- **Yahdle direct:** `localhost:5186/yahdle/` — the dev server on its own. Auth bounce will redirect to `/games/`, so this is mostly useful for spotting build errors.
- **Production (when deployed):** `katinkabeat.github.io/games/yahdle/`. Tile is gated for non-admins until `requires_access` is flipped in the `games_catalog` table.

## Daily seed

Every player on a given date sees the **same dice, same rolls, same Lexicon path**. The seed is built from the URL date plus an Atlantic-time rollover: `yahdle:daily:<YYYY-MM-DD>`. URL `/solo/2026-05-08` carries today's date.

If two admins want to compare strategy on the same puzzle, just play and compare scores — the dice are identical.

## Admin Reset (the ↻ button)

Top-right of the game's sub-header, only visible if you're an admin.

- **What it does:** wipes today's saved game **and** rolls a fresh puzzle variant. Each tap = a different starting hand.
- **How:** sets a random salt in `localStorage` (`yahdle:salt:<userId>:<gameId>`). Seed becomes `yahdle:daily:<date>:<salt>`. Salt persists across reloads, so closing and reopening the tab keeps you on the same variant until the next Reset.
- **To return to the canonical daily:** clear the `yahdle:salt:*` localStorage keys (devtools → Application → Local Storage), reload.

## URL tricks for testing

The `gameId` in the URL is just a string fed into the seed. So:

- `/solo/test-1`, `/solo/test-2`, ... — each gives a fresh deterministic puzzle
- `/solo/2026-05-09` — tomorrow's puzzle (work backwards or forwards in time)
- `/solo/2026-05-07` — yesterday's puzzle

Useful for sanity-checking dice distributions, or playing the same custom puzzle with friends without waiting for tomorrow.

## State storage

All game state is in `localStorage` under keys starting with `yahdle:`.

- `yahdle:state:<userId>:<gameId>` — current turn, score, dice faces, builder
- `yahdle:salt:<userId>:<gameId>` — admin Reset salt (admins only, blank for normal play)

To wipe everything Yahdle has stored: devtools → Application → Local Storage → filter on `yahdle:` → delete.

## Categories cheat sheet

| Category         | Validates                                |
|------------------|------------------------------------------|
| 3-Letter         | any 3-letter word                        |
| 4-Letter         | any 4-letter word                        |
| Lexicon          | uses all dice (currently 6-letter word)  |
| Double Up        | repeated letter                          |
| Vowel Heavy      | 3+ vowels (AEIOU)                        |
| Consonant Heavy  | 4+ consonants                            |
| High Value       | ≥10 pts                                  |
| Low Ball         | ≤4 pts                                   |
| Bookends         | same start & end letter                  |
| No Repeats       | all unique letters                       |
| Long Shot        | 5-letter, ≥12 pts                        |
| Wild Card        | any word                                 |

Word score = sum of Scrabble letter values (no multipliers).

## Letter pool

18 letters live on the dice: **A E I O U** (vowels) and **T R S N L D H M C P B W G** (consonants). **F K J Q V X Y Z are not on any die** — words containing them can't be spelled.

Top spelling letters (T R S N L) sit on 4 of the 6 dice each, so most rolls land at least one of them. Vowels A E I O U are on 4-5 dice each.

## When playtesting reveals a balance issue

- **A category never fires:** check the dictionary count via the eval trick (see commit history for the technique). If <10 valid words exist, lower the threshold.
- **A category always fires:** raise the threshold or rotate it out.
- **The dice feel impossible:** consider concentrating the alphabet further (drop letters, bump common-letter copies). 18 → 15 letters would make every roll trivially playable but shrink the dictionary.
- **Game ends with multiple unfilled categories:** add easier categories like "any 4-letter word with ≥6 pts" or replace Long Shot with a softer variant.

## What's not yet wired

- GitHub repo + GitHub Pages deploy (waiting on explicit go-ahead)
- Push notifications (no notification triggers exist yet — Yahdle is solo daily, not multiplayer)
- Hub catalog flip from `requires_access = true` to `false` (don't flip until everything tested)
- 6-letter category alongside Lexicon (would give Lexicon a non-overlapping companion)
