import { useCallback, useEffect, useState } from 'react'
import type { TownSnapshot } from '../data/models'
import { fetchTownLayout, saveTownLayout, TownSaveError } from '../data/townApi'
import type { EditorSelection } from './townEditing'

const HISTORY_LIMIT = 100

export type EditorNotice = 'saved' | 'conflict' | 'forbidden' | 'invalid' | 'error'
export type EditorStatus = 'idle' | 'loading' | 'error' | 'ready'

type EditorState = { key: string; base: TownSnapshot; current: TownSnapshot; history: TownSnapshot[] }

export function getSaveFailureNotice(error: unknown): EditorNotice {
  if (!(error instanceof TownSaveError)) return 'error'
  if (error.status === 409) return 'conflict'
  if (error.status === 401 || error.status === 403) return 'forbidden'
  return error.status === 400 ? 'invalid' : 'error'
}

export function editorStatus(key: string | null, state: EditorState | null, failedKey: string | null): EditorStatus {
  if (!key) return 'idle'
  if (state?.key === key) return 'ready'
  return failedKey === key ? 'error' : 'loading'
}

export function withHistory(state: EditorState, current: TownSnapshot): EditorState {
  return { ...state, current, history: [...state.history, state.current].slice(-HISTORY_LIMIT) }
}

/**
 * Edits always start from a fresh read of the saved town. When it cannot be read, or does not exist, the editor shows
 * its error state instead of starting from anything else, so it can never overwrite the saved town.
 */
export function useTownEditor(townId: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<EditorState | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [selection, setSelection] = useState<EditorSelection>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<EditorNotice | null>(null)
  const key = townId ? `${townId}:${attempt}` : null
  const status = editorStatus(key, state, failedKey)
  const dirty = status === 'ready' && state !== null && state.current !== state.base

  useEffect(() => {
    if (!townId || !key) return
    let active = true
    void fetchTownLayout(townId).then(
      (saved) => active && setState({ key, base: saved, current: saved, history: [] }),
      () => active && setFailedKey(key),
    )
    return () => {
      active = false
    }
  }, [key, townId])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** Records one undo step unless `recordHistory` is false, as for every frame after a drag's first. */
  const edit = useCallback((change: (town: TownSnapshot) => TownSnapshot, recordHistory = true) => {
    setState((current) => {
      if (!current) return current
      const next = change(current.current)
      if (next === current.current) return current
      return recordHistory ? withHistory(current, next) : { ...current, current: next }
    })
  }, [])

  const beginGesture = useCallback(() => {
    setState((current) => current && withHistory(current, current.current))
  }, [])

  const undo = useCallback(() => {
    setState((current) => {
      const previous = current?.history.at(-1)
      if (!current || !previous) return current
      return { ...current, current: previous, history: current.history.slice(0, -1) }
    })
  }, [])

  const discard = useCallback(() => {
    setState((current) => current && { ...current, current: current.base, history: [] })
    setSelection(null)
  }, [])

  const save = useCallback(async () => {
    if (!state || saving) return
    const sent = state.current
    setSaving(true)
    setNotice(null)
    try {
      const saved = await saveTownLayout(sent)
      // Edits made while the request was in flight stay unsaved but now build on the new revision.
      setState(
        (current) =>
          current && {
            ...current,
            base: saved,
            current: current.current === sent ? saved : { ...current.current, revision: saved.revision },
            history: current.current === sent ? [] : current.history,
          },
      )
      setNotice('saved')
    } catch (error) {
      setNotice(getSaveFailureNotice(error))
    } finally {
      setSaving(false)
    }
  }, [saving, state])

  return {
    status,
    town: status === 'ready' ? (state?.current ?? null) : null,
    dirty,
    canUndo: Boolean(state?.history.length),
    saving,
    notice,
    selection,
    select: setSelection,
    edit,
    beginGesture,
    undo,
    discard,
    save,
    retry: () => setAttempt((value) => value + 1),
    dismissNotice: () => setNotice(null),
  }
}

export type TownEditor = ReturnType<typeof useTownEditor>
