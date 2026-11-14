import { useCallback, useEffect, useRef } from 'react'

// Leaving the derby with a record this visit made and did not post. The page's own exits ask in a card of the game's
// (ui/LeaveView.tsx); closing or reloading the tab can only get the browser's own prompt, which this arms.

/**
 * While `active`, the browser asks before the tab closes, reloads, or goes elsewhere. `disarm` lets one navigation the
 * visitor already agreed to through, without waiting for a render.
 */
export function useLeaveGuard(active: boolean) {
  const armed = useRef(false)
  useEffect(() => {
    armed.current = active
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => {
      if (armed.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
  return useCallback(() => {
    armed.current = false
  }, [])
}

/** A link's click handed to `onLeave` instead of followed, so the page can ask first; without one the link is plain. */
export function leaveClick(path: string, onLeave: ((path: string) => void) | undefined) {
  if (!onLeave) return undefined
  return (event: { preventDefault: () => void }) => {
    event.preventDefault()
    onLeave(path)
  }
}
