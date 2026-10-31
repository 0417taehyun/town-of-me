import { useRef } from 'react'
import type { TownSnapshot } from '../data/models'
import type { TownEditor } from './useTownEditor'

/** The first change after a field gains focus records one undo step; the rest of that gesture joins it. */
export function useGestureEdit(edit: TownEditor['edit']) {
  const fresh = useRef(true)
  return {
    start: () => {
      fresh.current = true
    },
    apply: (change: (town: TownSnapshot) => TownSnapshot) => {
      edit(change, fresh.current)
      fresh.current = false
    },
  }
}
