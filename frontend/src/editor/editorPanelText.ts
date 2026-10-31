import type { TownObject, TownSnapshot } from '../data/models'
import { DialogueDraftError } from '../data/townApi'
import type { AppLanguage, languageCopy } from '../i18n/language'
import { resolveVariant } from '../scene/objectVariant'
import { TOWN_OBJECT_KINDS } from '../scene/objects/kinds'
import { getSelectedObjectIds } from './objectSelection'
import { getRemovalBlock, type EditorSelection, type RemovalBlock } from './townEditing'
import type { EditorNotice } from './useTownEditor'

type Copy = (typeof languageCopy)[AppLanguage]['editor']

/** Keys typed into a form field belong to that field, not to the editor's shortcuts. */
export function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')
}

/**
 * Delete or Backspace removes the selection, unless it is the pet's walk or the town still needs every selected
 * object.
 */
export function isDeleteShortcut(key: string, selection: EditorSelection, town: TownSnapshot) {
  if (!selection || selection.kind === 'pet' || !['Delete', 'Backspace'].includes(key)) return false
  return selection.kind === 'resident' || getSelectedObjectIds(selection).some((id) => !getRemovalBlock(town, id))
}

export function objectLabel(object: TownObject, copy: Copy) {
  return object.type === 'house' && object.ownerName
    ? `${copy.types.house} · ${object.ownerName}`
    : `${copy.types[object.type]} · ${object.id}`
}

/** A list row's name: a house by its owner, anything else by its kind and place in the list, counting from 1. */
export function objectRowLabel(object: TownObject, number: number, copy: Copy) {
  if (object.type === 'house' && object.ownerName) return object.ownerName
  return copy.objectName(copy.types[object.type], number)
}

/** The look an object shows, for kinds that have looks: its saved variant, or the one its id picks. */
export function objectVariantLabel(object: TownObject, copy: Copy) {
  if (!TOWN_OBJECT_KINDS[object.type].variants) return null
  return copy.variants[resolveVariant(object, object.type as 'flower' | 'bird' | 'tree')]
}

/** Why some selected objects are skipped, one sentence for each reason that applies. */
export function removalNotes(blocks: Record<RemovalBlock, string[]>, copy: Copy) {
  const notes = [
    [blocks.singleton.length, copy.keepsLandmarks],
    [blocks['bench-in-use'].length, copy.keepsBenchesInUse],
  ] as const
  return notes.filter(([count]) => count > 0).map(([count, note]) => note(count))
}

export function saveStatusText(dirty: boolean, revision: number, copy: Copy) {
  return dirty ? copy.unsaved : copy.saved(revision)
}

export function noticeMessage(notice: EditorNotice, copy: Copy) {
  return {
    saved: copy.saveSucceeded,
    conflict: copy.saveConflict,
    forbidden: copy.saveForbidden,
    invalid: copy.saveInvalid,
    error: copy.saveError,
  }[notice]
}

export function draftFailureMessage(error: unknown, copy: Copy) {
  if (!(error instanceof DialogueDraftError)) return copy.draftError
  if (error.status === 401 || error.status === 403) return copy.saveForbidden
  if (error.status === 503) return copy.draftUnavailable(error.reason)
  return copy.draftError
}
