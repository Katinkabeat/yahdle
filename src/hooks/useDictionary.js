import { useEffect, useState } from 'react'
import { loadDictionary } from '../lib/dictionary.js'

// Lazily loads the TWL Scrabble dictionary once on mount, returns the
// shared cached set. Both Solo and Multi game pages call this so the
// "is this a real word?" gate is identical on both surfaces.
export function useDictionary() {
  const [dict, setDict] = useState(null)
  const [dictReady, setDictReady] = useState(false)

  useEffect(() => {
    let active = true
    loadDictionary().then(set => {
      if (!active) return
      setDict(set)
      setDictReady(true)
    })
    return () => { active = false }
  }, [])

  return { dict, dictReady }
}
