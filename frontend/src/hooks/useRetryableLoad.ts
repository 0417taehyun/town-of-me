import { useCallback, useEffect, useState } from 'react'

export type LoadStatus = 'loading' | 'ready' | 'error'

export function loadStatus(
  loadedAttempt: number | undefined,
  failedAttempt: number | null,
  attempt: number,
): LoadStatus {
  if (loadedAttempt === attempt) return 'ready'
  return failedAttempt === attempt ? 'error' : 'loading'
}

/**
 * Loads on mount and again on every `retry`. `latest` keeps the last loaded value while a retry is in flight; a
 * result that arrives after the component unmounts is dropped. `load` must keep its identity between renders.
 */
export function useRetryableLoad<Value>(load: () => Promise<Value>) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ attempt: number; value: Value } | null>(null)
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    void load().then(
      (value) => active && setLoaded({ attempt, value }),
      () => active && setFailedAttempt(attempt),
    )
    return () => {
      active = false
    }
  }, [attempt, load])

  const retry = useCallback(() => setAttempt((current) => current + 1), [])
  /** Applies `change` to the latest value, in case another change finished first. */
  const update = useCallback(
    (change: (value: Value) => Value) =>
      setLoaded((current) => current && { ...current, value: change(current.value) }),
    [],
  )
  return { status: loadStatus(loaded?.attempt, failedAttempt, attempt), latest: loaded?.value, retry, update }
}
