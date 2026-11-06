import { useCallback, useEffect, useState } from 'react'
import { rankingMonth, upcomingBallparkRules } from '../data/ballparkRules'
import type { BallparkSettings, TownSnapshot } from '../data/models'
import { fetchTownLayout, saveTownLayout, TownSaveError } from '../data/townApi'
import type { EditorSelection } from './townEditing'

const HISTORY_LIMIT = 100

export type EditorNotice = 'saved' | 'conflict' | 'forbidden' | 'invalid' | 'error'
export type EditorStatus = 'idle' | 'loading' | 'error' | 'ready'

export type EditorState = { key: string; base: TownSnapshot; current: TownSnapshot; history: TownSnapshot[] }

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
 * A town edited while `sent` was being saved stays unsaved but builds on the new revision. Untouched venues take the
 * saved ones, and an edited ballpark keeps only the admin's changes over them (`rebaseBallpark`), since the backend
 * owns the ballpark rules and may have promoted a schedule; resending the old schedule after that would be rejected.
 */
export function rebaseOnSave(
  current: TownSnapshot,
  sent: TownSnapshot,
  saved: TownSnapshot,
  month: string,
): TownSnapshot {
  if (current === sent) return saved
  if (current.venues === sent.venues) return { ...current, venues: saved.venues, revision: saved.revision }
  const ballpark = rebaseBallpark(current.venues.ballpark, sent.venues.ballpark, saved.venues.ballpark, month)
  return { ...current, venues: { ...current.venues, ballpark }, revision: saved.revision }
}

/**
 * The admin's switch and look on the backend's rules in effect, with the backend's schedule unless the admin changed it since
 * `sent`. A schedule due by the KST `month` is never kept: that save promoted it, so sending it again would be refused.
 */
export function rebaseBallpark(
  edited: BallparkSettings,
  sent: BallparkSettings,
  saved: BallparkSettings,
  month: string,
): BallparkSettings {
  const scheduledRules =
    edited.scheduledRules === sent.scheduledRules ? saved.scheduledRules : upcomingBallparkRules(edited, month)
  return {
    visible: edited.visible,
    theme: edited.theme,
    colors: edited.colors,
    rules: saved.rules,
    ...(scheduledRules ? { scheduledRules } : {}),
  }
}

/**
 * The editor once `sent` is saved as `saved`. Undo stops at the saved town, as after any save: an undo step from
 * before it could resend what the save replaced, such as a schedule it promoted, so those steps go. Edits made while it
 * was saving keep their undo steps, rebased on it like the town itself.
 */
export function afterSave(state: EditorState, sent: TownSnapshot, saved: TownSnapshot, month: string): EditorState {
  const sentStep = state.history.lastIndexOf(sent)
  const steps = state.current === sent || sentStep < 0 ? [] : state.history.slice(sentStep)
  return {
    ...state,
    base: saved,
    current: rebaseOnSave(state.current, sent, saved, month),
    history: steps.map((step) => rebaseOnSave(step, sent, saved, month)),
  }
}

/**
 * Edits always start from a fresh read of the saved town. When it cannot be read, or does not exist, the editor shows
 * its error state instead of starting from anything else, so it can never overwrite the saved town.
 */
export function useTownEditor(enabled: boolean) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<EditorState | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [selection, setSelection] = useState<EditorSelection>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<EditorNotice | null>(null)
  const key = enabled ? String(attempt) : null
  const status = editorStatus(key, state, failedKey)
  const dirty = status === 'ready' && state !== null && state.current !== state.base

  useEffect(() => {
    if (!key) return
    let active = true
    void fetchTownLayout().then(
      (saved) => active && setState({ key, base: saved, current: saved, history: [] }),
      () => active && setFailedKey(key),
    )
    return () => {
      active = false
    }
  }, [key])

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
      const month = rankingMonth(new Date())
      setState((current) => current && afterSave(current, sent, saved, month))
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
