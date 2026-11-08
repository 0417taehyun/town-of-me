import { lazy, Suspense, useEffect, useEffectEvent, useState, type MutableRefObject, type ReactNode } from 'react'
import { MathUtils, type Vector3 } from 'three'
import { CURRENT_RULES_PREVIEW_PATH, NEXT_RULES_PREVIEW_PATH } from '../baseball/baseballRoute'
import {
  effectiveBallparkRules,
  plannedBallparkRules,
  rankingMonth,
  upcomingBallparkRules,
} from '../data/ballparkRules'
import {
  BALLPARK_COLOR_ROLES,
  BASEBALL_DIFFICULTIES,
  PET_ROUTE_POINTS,
  PITCH_COUNT_RANGE,
  type BaseballDifficulty,
  type LocalizedText,
  type TownMovement,
  type TownObject,
  type TownObjectType,
  type TownOwner,
  type TownResident,
  type TownSnapshot,
  type Vec3,
} from '../data/models'
import { GAIT_STYLES, type GaitStyle } from '../scene/motion/gait'
import { SKID_STYLES, type SkidStyle } from '../scene/motion/skidTurn'
import { TOWN_OBJECT_KINDS } from '../scene/objects/kinds'
import { appearanceFields, DEFAULT_PLAYER_PROFILE } from '../data/playerProfile'
import { linkedInProfileUrlError } from '../data/linkedInProfile'
import type { AppLanguage } from '../i18n/language'
import { languageCopy, monthName } from '../i18n/language'
import { resolveBallparkPalette } from '../scene/venues/ballpark/ballparkThemes'
import { getVenueGatePoint } from '../scene/venues/venuePlacements'
import { AppearanceSection, ColorChoice } from '../ui/CharacterAppearanceControls'
import { CloseButton } from '../ui/CloseButton'
import {
  duplicateObjects,
  getRemovalBlocks,
  getSharedValue,
  randomizeRotations,
  randomizeSizes,
  removeObjects,
  ROTATION_LIMITS_IN_DEGREES,
  setObjectsVariant,
  SIZE_LIMITS,
  type NumberRange,
} from './bulkEditing'
import {
  addObject,
  addPetRoutePoint,
  addResident,
  addRoadPoint,
  addRoutePoint,
  changeObject,
  changeObjects,
  changeResident,
  EMPTY_LOCALIZED_TEXT,
  getLayoutProblems,
  getObjectProblems,
  getRemovalBlock,
  getResidentProblems,
  isHalfWritten,
  isInvalidContactEmail,
  isSkyObject,
  PET_SELECTION,
  problemSelection,
  removeObject,
  removePetRoutePoint,
  removeResident,
  removeRoadPoint,
  removeRoutePoint,
  resetPetRoute,
  setResidentOwnership,
  startPetRoute,
  updateResidentProfile,
  withBallparkColor,
  withBallparkSchedule,
  withBallparkVisible,
  withoutBallparkSchedule,
  type EditorSelection,
  type EditorView,
  type LayoutProblem,
  type SingleSelection,
} from './townEditing'
import {
  isDeleteShortcut,
  isTypingTarget,
  noticeMessage,
  objectLabel,
  removalNotes,
  saveStatusText,
} from './editorPanelText'
import { AdminEmails } from './AdminEmails'
import { GuestbookReview } from './GuestbookReview'
import { MovementPreview } from './MovementPreview'
import { ObjectBrowser } from './ObjectBrowser'
import {
  getFocusPoint,
  getSelectedObjects,
  getSelectionCategory,
  selectObjects,
  type EditorCategory,
} from './objectSelection'
import { LocalizedField, OwnerConversationFields, ResidentConversationFields } from './ResidentConversationFields'
import { ResidentPreview } from './ResidentPreview'
import { useGestureEdit } from './useGestureEdit'
import type { TownEditor } from './useTownEditor'
import { getPetBlockedLegs, getResidentBlockedLegs } from './walkCrossings'

type Copy = (typeof languageCopy)[AppLanguage]['editor']

// In its own chunk, so the editor's first load carries none of the derby. No error boundary stands above the panel, so
// a chunk that fails to load (a deploy replaced it) must not take unsaved edits down with it. The try covers the whole
// load: Vite preloads the chunk's styles before `import()` runs, outside any `.then` chained on it.
const BoardReview = lazy(async () => {
  try {
    const { BoardReview: LoadedBoardReview } = await import('./BoardReview')
    return { default: LoadedBoardReview }
  } catch {
    return { default: BoardReviewUnavailable }
  }
})
// Its own chunk too, for the same reasons; its words stay out of what visitors load.
const UsageStats = lazy(async () => {
  try {
    const { UsageStats: LoadedUsageStats } = await import('./UsageStats')
    return { default: LoadedUsageStats }
  } catch {
    return { default: UsageStatsUnavailable }
  }
})
type Edit = TownEditor['edit']

const seatOptions = [1, 2].map((seats) => ({ value: seats, label: String(seats) }))
// Not a variant name, which never starts with a colon (see backend/src/town.ts).
const mixedOptionValue = ':mixed'
// Mirrors the name, introduction, and email limits in backend/src/town.ts and backend/src/admins.ts.
const townNameLimit = 24
const introductionLimit = 600
const emailLengthLimit = 254
const ownerIntroductionId = 'editor-owner-introduction'

/**
 * The owner and the pet as visitors meet them: names read in conversations, the guide, and signs, and the owner's
 * introduction and contact email; shown in the town settings.
 */
export function TownNameFields({
  town,
  language,
  copy,
  edit,
}: {
  town: TownSnapshot
  language: AppLanguage
  copy: Copy
  edit: Edit
}) {
  const rename = (member: 'owner' | 'pet') => (name: LocalizedText) => (current: TownSnapshot) => ({
    ...current,
    [member]: { ...current[member], name },
  })
  const changeOwner = (changes: Partial<TownOwner>) => (current: TownSnapshot) => ({
    ...current,
    owner: { ...current.owner, ...changes },
  })
  const introduction = town.owner.introduction ?? EMPTY_LOCALIZED_TEXT
  return (
    <fieldset className="editor-appearance">
      <legend>{copy.namesTitle}</legend>
      <LocalizedField
        label={copy.townOwner}
        value={town.owner.name}
        maxLength={townNameLimit}
        multiline={false}
        copy={copy}
        edit={edit}
        onChange={rename('owner')}
      />
      <LocalizedField
        id={ownerIntroductionId}
        label={copy.ownerIntroduction}
        value={introduction}
        maxLength={introductionLimit}
        copy={copy}
        edit={edit}
        onChange={(text) => changeOwner({ introduction: text })}
      />
      {isHalfWritten(introduction) && (
        <small className="editor-field-error">{copy.problems['owner-introduction']}</small>
      )}
      <p className="editor-note">{copy.ownerIntroductionHint}</p>
      <TextField
        label={copy.contactEmail}
        type="email"
        value={town.owner.contactEmail ?? ''}
        maxLength={emailLengthLimit}
        invalid={isInvalidContactEmail(town.owner.contactEmail) ? copy.problems['contact-email'] : undefined}
        edit={edit}
        onChange={(contactEmail) => changeOwner({ contactEmail })}
      />
      <p className="editor-note">{copy.contactEmailHint(town.owner.name[language])}</p>
      <TextField
        label={copy.linkedIn}
        type="url"
        value={town.owner.linkedInProfileUrl ?? ''}
        maxLength={300}
        invalid={linkedInProfileUrlError(town.owner.linkedInProfileUrl ?? '') ? copy.problems.linkedin : undefined}
        edit={edit}
        onChange={(linkedInProfileUrl) => changeOwner({ linkedInProfileUrl })}
      />
      <p className="editor-note">{copy.ownerLinkedInHint}</p>
      <LocalizedField
        label={copy.townPet}
        value={town.pet.name}
        maxLength={townNameLimit}
        multiline={false}
        copy={copy}
        edit={edit}
        onChange={rename('pet')}
      />
    </fieldset>
  )
}

/**
 * The pet's walk: the default loop around the fountain until the admin starts editing it, then its own loop, edited
 * with the same handles and point actions as a resident's route while it is selected.
 */
export function PetWalkFields({
  town,
  selection,
  language,
  copy,
  edit,
  onSelect,
}: {
  town: TownSnapshot
  selection: EditorSelection
  language: AppLanguage
  copy: Copy
  edit: Edit
  onSelect: (selection: EditorSelection) => void
}) {
  const route = town.pet.route
  const editing = selection?.kind === 'pet'
  const pointIndex = editing ? selection.pointIndex : undefined
  return (
    <fieldset className="editor-appearance">
      <legend>{copy.petWalk(town.pet.name[language])}</legend>
      {!route && <p className="editor-note">{copy.petWalkDefault}</p>}
      {editing && <BlockedLegsWarning count={getPetBlockedLegs(town).length} copy={copy} />}
      {editing && route && (
        <PointActions
          copy={copy}
          pointCount={route.length}
          canRemove={pointIndex !== undefined && route.length > PET_ROUTE_POINTS.minimum}
          onAdd={() => edit(addPetRoutePoint)}
          onRemove={() => {
            if (pointIndex === undefined) return
            edit((current) => removePetRoutePoint(current, pointIndex))
            onSelect(PET_SELECTION)
          }}
        />
      )}
      <div className="editor-actions">
        {!(editing && route) && (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              edit(startPetRoute)
              onSelect(PET_SELECTION)
            }}
          >
            {copy.editPetWalk}
          </button>
        )}
        <button
          className="text-button"
          type="button"
          disabled={!route}
          onClick={() => {
            edit(resetPetRoute)
            onSelect(null)
          }}
        >
          {copy.useDefaultWalk}
        </button>
      </div>
    </fieldset>
  )
}

/** How everyone in the town walks and skids, shown in the town settings. */
export function TownMovementFields({
  town,
  language,
  copy,
  edit,
}: {
  town: TownSnapshot
  language: AppLanguage
  copy: Copy
  edit: Edit
}) {
  const choose = (change: Partial<TownMovement>) =>
    edit((current) => ({ ...current, movement: { ...current.movement, ...change } }))
  return (
    <fieldset className="editor-appearance">
      <legend>{copy.movementTitle}</legend>
      <SelectField
        label={copy.gait}
        value={town.movement.gait}
        options={GAIT_STYLES.map((style) => ({ value: style, label: copy.gaitStyles[style] }))}
        onChange={(gait) => choose({ gait: gait as GaitStyle })}
      />
      <SelectField
        label={copy.skid}
        value={town.movement.skid}
        options={SKID_STYLES.map((style) => ({ value: style, label: copy.skidStyles[style] }))}
        onChange={(skid) => choose({ skid: skid as SkidStyle })}
      />
      <MovementPreview
        language={language}
        movement={town.movement}
        profile={town.residents[0]?.profile ?? DEFAULT_PLAYER_PROFILE}
        labels={copy.movementSteps}
        label={copy.movementPreview}
      />
      <p className="editor-note">{copy.movementNote}</p>
    </fieldset>
  )
}

/**
 * Whether visitors see the ballpark and its building colors, both applied once saved, and the rules for next month:
 * the rules in effect never change within a KST month, so the admin only schedules. The preview of a hidden ballpark
 * or of the schedule opens /baseball in this tab, because a new tab would start without this tab's session storage
 * (the visitor's character and language) behind /baseball's opener isolation; leaving would lose unsaved edits, so
 * those links show only when everything is saved.
 */
export function BallparkSettingsFields({
  town,
  language,
  dirty,
  edit,
  onView,
}: {
  town: TownSnapshot
  language: AppLanguage
  dirty: boolean
  edit: Edit
  /** Moves the editor's camera to the gate, hidden or shown; a hidden ballpark shows only the hedge's closed stretch. */
  onView: () => void
}) {
  const copy = languageCopy[language].venues.ballpark
  const ballpark = town.venues.ballpark
  // The device's clock picks the month, both shown and scheduled from. Near the KST month boundary a fast clock
  // promotes a stored schedule early, and a rules edit then drops or moves it on save; the backend cannot tell that
  // from a real cancel or reschedule.
  const month = rankingMonth(new Date())
  const inEffect = effectiveBallparkRules(ballpark, month)
  const upcoming = upcomingBallparkRules(ballpark, month)
  const planned = plannedBallparkRules(ballpark, month)
  const palette = resolveBallparkPalette(ballpark)
  return (
    <fieldset className="editor-appearance">
      <legend>{copy.settingsTitle}</legend>
      <label className="editor-check">
        <input
          type="checkbox"
          role="switch"
          checked={ballpark.visible}
          onChange={(event) => {
            const visible = event.currentTarget.checked
            edit((current) => withBallparkVisible(current, visible))
          }}
        />
        {copy.visible}
      </label>
      <p className="editor-note">{copy.visibleNote}</p>
      <div className="editor-actions">
        <button className="text-button" type="button" onClick={onView}>
          {copy.view}
        </button>
        {!ballpark.visible && !dirty && (
          <a className="text-button" href={CURRENT_RULES_PREVIEW_PATH}>
            {copy.preview}
          </a>
        )}
      </div>
      {BALLPARK_COLOR_ROLES.map((role) => (
        <ColorValueField
          key={role}
          label={copy.colorRoles[role]}
          value={palette[role]}
          overridden={ballpark.colors[role] !== undefined}
          resetLabel={copy.themeColor}
          edit={edit}
          onChange={(color) => (current) => withBallparkColor(current, role, color)}
        />
      ))}
      <p className="editor-note">{copy.colorsNote}</p>
      <fieldset className="editor-appearance">
        <legend>{copy.nextRulesTitle}</legend>
        <ul className="editor-rules">
          <li>{copy.rulesThisMonth(inEffect.pitchCount, copy.difficulties[inEffect.difficulty])}</li>
          {upcoming && (
            <li>
              {copy.rulesFrom(
                monthName(upcoming.fromMonth, month, language),
                upcoming.rules.pitchCount,
                copy.difficulties[upcoming.rules.difficulty],
              )}
            </li>
          )}
        </ul>
        <RangeField
          label={copy.pitchCount}
          value={planned.pitchCount}
          min={PITCH_COUNT_RANGE.minimum}
          max={PITCH_COUNT_RANGE.maximum}
          step={1}
          edit={edit}
          onChange={(pitchCount) => (current) => withBallparkSchedule(current, { pitchCount }, month)}
        />
        <SelectField
          label={copy.difficulty}
          value={planned.difficulty}
          options={BASEBALL_DIFFICULTIES.map((difficulty) => ({
            value: difficulty,
            label: copy.difficulties[difficulty],
          }))}
          onChange={(difficulty) =>
            edit((current) => withBallparkSchedule(current, { difficulty: difficulty as BaseballDifficulty }, month))
          }
        />
        <p className="editor-note">{copy.difficultyNote}</p>
        <p className="editor-note">{copy.nextRulesNote}</p>
        {upcoming && (
          <div className="editor-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => edit((current) => withoutBallparkSchedule(current, month))}
            >
              {copy.cancelSchedule}
            </button>
            {!dirty && (
              <a className="text-button" href={NEXT_RULES_PREVIEW_PATH}>
                {copy.tryNextRules}
              </a>
            )}
          </div>
        )}
        {upcoming && dirty && <p className="editor-note">{copy.saveToTry}</p>}
      </fieldset>
    </fieldset>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function SelectField({
  label,
  value,
  options,
  mixedLabel,
  onChange,
}: {
  label: string
  value: string | number
  options: ReadonlyArray<{ value: string | number; label: string }>
  /** Shown instead of a value while several selected objects differ. */
  mixedLabel?: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      <select value={mixedLabel ? mixedOptionValue : value} onChange={(event) => onChange(event.currentTarget.value)}>
        {mixedLabel && (
          <option value={mixedOptionValue} disabled>
            {mixedLabel}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  valueText,
  edit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  /** Shown instead of the value, such as "Mixed" while several selected objects differ. */
  valueText?: string
  edit: Edit
  onChange: (value: number) => (town: TownSnapshot) => TownSnapshot
}) {
  const gesture = useGestureEdit(edit)
  return (
    <Field label={label}>
      <span className="editor-range">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onPointerDown={gesture.start}
          onKeyDown={gesture.start}
          onChange={(event) => gesture.apply(onChange(Number(event.currentTarget.value)))}
        />
        <output>{valueText ?? `${value}${unit}`}</output>
      </span>
    </Field>
  )
}

/** Keeps the typed text while it is not a number yet, such as a lone minus sign. */
export function NumberField({
  label,
  value,
  edit,
  onChange,
}: {
  label: string
  value: number
  edit: Edit
  onChange: (value: number) => (town: TownSnapshot) => TownSnapshot
}) {
  const gesture = useGestureEdit(edit)
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Field label={label}>
      <input
        type="number"
        step={0.5}
        value={draft ?? String(value)}
        onFocus={gesture.start}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          const text = event.currentTarget.value
          setDraft(text)
          if (text.trim() && Number.isFinite(Number(text))) gesture.apply(onChange(Number(text)))
        }}
      />
    </Field>
  )
}

export function TextField({
  label,
  value,
  maxLength,
  type = 'text',
  invalid,
  edit,
  onChange,
}: {
  label: string
  value: string
  maxLength: number
  type?: 'text' | 'url' | 'email'
  invalid?: string
  edit: Edit
  onChange: (value: string) => (town: TownSnapshot) => TownSnapshot
}) {
  const gesture = useGestureEdit(edit)
  return (
    <Field label={label}>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        aria-invalid={Boolean(invalid)}
        onFocus={gesture.start}
        onChange={(event) => gesture.apply(onChange(event.currentTarget.value))}
      />
      {invalid && <small className="editor-field-error">{invalid}</small>}
    </Field>
  )
}

/** One color for every object given; it shows "Mixed" while they differ. */
export function ColorField({ objects, copy, edit }: { objects: readonly TownObject[]; copy: Copy; edit: Edit }) {
  const gesture = useGestureEdit(edit)
  const ids = objects.map(({ id }) => id)
  const colors = objects.map((object) => object.color ?? TOWN_OBJECT_KINDS[object.type].defaultColor)
  const sharedColor = getSharedValue(colors)
  return (
    <Field label={copy.color}>
      <span className="editor-color">
        <input
          type="color"
          value={sharedColor ?? colors[0]}
          onFocus={gesture.start}
          onClick={gesture.start}
          onChange={(event) => {
            const color = event.currentTarget.value
            gesture.apply(changeObjects(ids, { color }))
          }}
        />
        {sharedColor === undefined && <span className="editor-mixed">{copy.mixed}</span>}
        <button
          className="text-button"
          type="button"
          disabled={objects.every(({ color }) => !color)}
          onClick={() => edit(changeObjects(ids, { color: undefined }))}
        >
          {copy.defaultColor}
        </button>
      </span>
    </Field>
  )
}

/** A color shown as it applies, the default while nothing overrides it; `onChange(null)` gives it back the default. */
export function ColorValueField({
  label,
  value,
  overridden,
  resetLabel,
  edit,
  onChange,
}: {
  label: string
  value: string
  overridden: boolean
  resetLabel: string
  edit: Edit
  onChange: (color: string | null) => (town: TownSnapshot) => TownSnapshot
}) {
  const gesture = useGestureEdit(edit)
  return (
    <Field label={label}>
      <span className="editor-color">
        <input
          type="color"
          value={value}
          onFocus={gesture.start}
          onClick={gesture.start}
          onChange={(event) => gesture.apply(onChange(event.currentTarget.value))}
        />
        <button
          className="text-button"
          type="button"
          aria-label={`${resetLabel} (${label})`}
          disabled={!overridden}
          onClick={() => edit(onChange(null))}
        >
          {resetLabel}
        </button>
      </span>
    </Field>
  )
}

export function PointActions({
  copy,
  pointCount,
  canRemove,
  onAdd,
  onRemove,
}: {
  copy: Copy
  pointCount: number
  canRemove: boolean
  onAdd: () => void
  onRemove: () => void
}) {
  return (
    <div className="editor-points">
      <p>{copy.pointHelp}</p>
      <div className="editor-actions">
        <button className="text-button" type="button" onClick={onAdd}>
          {copy.addPoint}
        </button>
        <button className="text-button" type="button" disabled={!canRemove || pointCount <= 2} onClick={onRemove}>
          {copy.removePoint}
        </button>
      </div>
    </div>
  )
}

/** A walk that cuts through something solid still saves; the status announces the count as points move. */
export function BlockedLegsWarning({ count, copy }: { count: number; copy: Copy }) {
  return (
    <div role="status">
      {count > 0 && <p className="editor-note editor-route-warning">{copy.blockedLegs(count)}</p>}
    </div>
  )
}

export function ObjectInspector({
  town,
  object,
  selection,
  copy,
  edit,
  onSelect,
}: {
  town: TownSnapshot
  object: TownObject
  selection: SingleSelection
  copy: Copy
  edit: Edit
  onSelect: (selection: EditorSelection) => void
}) {
  const sky = isSkyObject(object.type)
  const variants = TOWN_OBJECT_KINDS[object.type].variants
  const block = getRemovalBlock(town, object.id)
  const update = (changes: Partial<TownObject>) => changeObject(object.id, changes)
  const pointIndex = selection.pointIndex
  return (
    <>
      <h3>{objectLabel(object, copy)}</h3>
      <div className="editor-grid">
        <NumberField
          label={copy.x}
          value={object.position.x}
          edit={edit}
          onChange={(x) => update({ position: { ...object.position, x } })}
        />
        <NumberField
          label={copy.z}
          value={object.position.z}
          edit={edit}
          onChange={(z) => update({ position: { ...object.position, z } })}
        />
      </div>
      {sky && (
        <RangeField
          label={copy.height}
          value={object.position.y}
          min={2}
          max={40}
          step={0.5}
          edit={edit}
          onChange={(y) => update({ position: { ...object.position, y } })}
        />
      )}
      {object.type !== 'road' && (
        <RangeField
          label={sky ? copy.heading : copy.rotation}
          value={Math.round(MathUtils.radToDeg(object.rotation))}
          min={-180}
          max={180}
          step={5}
          unit="°"
          edit={edit}
          onChange={(value) => update({ rotation: MathUtils.degToRad(value) })}
        />
      )}
      {object.type !== 'road' && (
        <RangeField
          label={copy.scale}
          value={object.scale}
          min={SIZE_LIMITS.minimum}
          max={SIZE_LIMITS.maximum}
          step={0.05}
          unit="×"
          edit={edit}
          onChange={(scale) => update({ scale })}
        />
      )}
      <ColorField objects={[object]} copy={copy} edit={edit} />
      {variants && (
        <SelectField
          label={copy.variant}
          value={object.variant ?? ''}
          options={[
            { value: '', label: copy.automaticVariant },
            ...variants.map((variant) => ({ value: variant, label: copy.variants[variant] })),
          ]}
          onChange={(variant) => edit(update({ variant: variant || undefined }))}
        />
      )}
      {object.type === 'bench' && (
        <SelectField
          label={copy.seats}
          value={object.seats ?? 2}
          options={seatOptions}
          onChange={(seats) => edit(update({ seats: seats === '1' ? 1 : 2 }))}
        />
      )}
      {object.type === 'road' && (
        <>
          <RangeField
            label={copy.width}
            value={object.width ?? 4}
            min={1}
            max={12}
            step={0.5}
            edit={edit}
            onChange={(width) => update({ width })}
          />
          <PointActions
            copy={copy}
            pointCount={object.points?.length ?? 0}
            canRemove={pointIndex !== undefined}
            onAdd={() => edit((current) => addRoadPoint(current, object.id))}
            onRemove={() => {
              if (pointIndex === undefined) return
              edit((current) => removeRoadPoint(current, object.id, pointIndex))
              onSelect({ kind: 'object', id: object.id })
            }}
          />
        </>
      )}
      {object.type === 'house' && <HouseFields object={object} copy={copy} edit={edit} />}
      <div className="editor-actions">
        <button
          className="text-button"
          type="button"
          disabled={block === 'singleton'}
          onClick={() => {
            const copied = duplicateObjects(town, [object.id])
            edit(() => copied.town)
            onSelect(selectObjects(copied.ids))
          }}
        >
          {copy.duplicate}
        </button>
        <button
          className="text-button danger"
          type="button"
          disabled={Boolean(block)}
          onClick={() => {
            edit((current) => removeObject(current, object.id))
            onSelect(null)
          }}
        >
          {copy.remove}
        </button>
      </div>
      {block && <p className="editor-note">{block === 'singleton' ? copy.uniqueObject : copy.benchInUse}</p>}
    </>
  )
}

export function HouseFields({ object, copy, edit }: { object: TownObject; copy: Copy; edit: Edit }) {
  const problems = getObjectProblems(object)
  const update = (changes: Partial<TownObject>) => changeObject(object.id, changes)
  return (
    <>
      <TextField
        label={copy.ownerName}
        value={object.ownerName ?? ''}
        maxLength={40}
        invalid={problems.includes('owner-name') ? copy.problems['owner-name'] : undefined}
        edit={edit}
        onChange={(ownerName) => update({ ownerName })}
      />
      <TextField
        label={copy.description}
        value={object.description ?? ''}
        maxLength={120}
        edit={edit}
        onChange={(description) => update({ description })}
      />
      <TextField
        label={copy.linkedIn}
        type="url"
        value={object.linkedInProfileUrl ?? ''}
        maxLength={300}
        invalid={problems.includes('linkedin') ? copy.problems.linkedin : undefined}
        edit={edit}
        onChange={(linkedInProfileUrl) => update({ linkedInProfileUrl })}
      />
    </>
  )
}

export function ResidentInspector({
  town,
  resident,
  selection,
  language,
  copy,
  edit,
  onSelect,
  onShowTownSettings,
}: {
  town: TownSnapshot
  resident: TownResident
  selection: SingleSelection
  language: AppLanguage
  copy: Copy
  edit: Edit
  onSelect: (selection: EditorSelection) => void
  onShowTownSettings: () => void
}) {
  const benches = town.objects.filter(({ type }) => type === 'bench')
  const update = (changes: Partial<TownResident>) => changeResident(resident.id, changes)
  const profile = resident.profile
  const pointIndex = selection.pointIndex
  const owner = town.owner.residentId === resident.id
  const editOwnerIntroduction = () => {
    onShowTownSettings()
    // The town settings appear once they render.
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`#${ownerIntroductionId} :is(input, textarea)`)?.focus(),
    )
  }
  return (
    <>
      <h3>{`${copy.resident} · ${resident.name}`}</h3>
      <TextField
        label={copy.name}
        value={resident.name}
        maxLength={24}
        invalid={resident.name.trim() ? undefined : copy.problems['resident-name']}
        edit={edit}
        onChange={(name) => update({ name })}
      />
      <label className="editor-check">
        <input
          type="checkbox"
          checked={owner}
          onChange={(event) => {
            const checked = event.currentTarget.checked
            edit((current) => setResidentOwnership(current, resident.id, checked))
          }}
        />
        {copy.ownerResident}
      </label>
      <TextField
        label={copy.linkedIn}
        type="url"
        value={resident.linkedInProfileUrl ?? ''}
        maxLength={300}
        invalid={
          getResidentProblems(resident).includes('resident-linkedin') ? copy.problems['resident-linkedin'] : undefined
        }
        edit={edit}
        onChange={(linkedInProfileUrl) => update({ linkedInProfileUrl })}
      />
      <SelectField
        label={copy.bench}
        value={resident.benchId}
        options={benches.map(({ id }) => ({ value: id, label: id }))}
        onChange={(benchId) => edit(update({ benchId }))}
      />
      <SelectField
        label={copy.benchStop}
        value={resident.seatIndex}
        options={resident.route.map((_, index) => ({ value: index, label: copy.routePoint(index + 1) }))}
        onChange={(seatIndex) => edit(update({ seatIndex: Number(seatIndex) }))}
      />
      <label className="editor-check">
        <input
          type="checkbox"
          checked={resident.startSeated}
          onChange={(event) => edit(update({ startSeated: event.currentTarget.checked }))}
        />
        {copy.startSeated}
      </label>
      <PointActions
        copy={copy}
        pointCount={resident.route.length}
        canRemove={pointIndex !== undefined && pointIndex !== resident.seatIndex}
        onAdd={() => edit((current) => addRoutePoint(current, resident.id))}
        onRemove={() => {
          if (pointIndex === undefined) return
          edit((current) => removeRoutePoint(current, resident.id, pointIndex))
          onSelect({ kind: 'resident', id: resident.id })
        }}
      />
      <BlockedLegsWarning count={getResidentBlockedLegs(town, resident).length} copy={copy} />
      {owner ? (
        <OwnerConversationFields
          questions={town.owner.questions}
          copy={copy}
          edit={edit}
          onEditIntroduction={editOwnerIntroduction}
        />
      ) : (
        <ResidentConversationFields
          resident={resident}
          owner={town.owner.name}
          language={language}
          copy={copy}
          edit={edit}
        />
      )}
      <fieldset className="editor-appearance">
        <legend>{copy.appearance}</legend>
        <ColorChoice
          language={language}
          field="skin"
          value={profile.colors.skin}
          onChange={(color) =>
            edit((current) =>
              updateResidentProfile(current, resident.id, { ...profile, colors: { ...profile.colors, skin: color } }),
            )
          }
        />
        <div className="creator-options">
          {appearanceFields.map((field) => (
            <AppearanceSection
              key={field}
              language={language}
              field={field}
              profile={profile}
              onChoice={(choice) =>
                edit((current) => updateResidentProfile(current, resident.id, { ...profile, [field]: choice }))
              }
              onColor={(color) =>
                edit((current) =>
                  updateResidentProfile(current, resident.id, {
                    ...profile,
                    colors: { ...profile.colors, [field]: color },
                  }),
                )
              }
            />
          ))}
        </div>
      </fieldset>
      <div className="editor-actions">
        <button
          className="text-button danger"
          type="button"
          onClick={() => {
            edit((current) => removeResident(current, resident.id))
            onSelect(null)
          }}
        >
          {copy.remove}
        </button>
      </div>
    </>
  )
}

/** Two ends and a button that gives every selected object its own value between them, as one undo step. */
export function RandomRangeFields({
  legend,
  initial,
  limits,
  step,
  unit = '',
  copy,
  onRandomize,
}: {
  legend: string
  initial: NumberRange
  limits: NumberRange
  step: number
  unit?: string
  copy: Copy
  onRandomize: (range: NumberRange) => void
}) {
  const [from, setFrom] = useState(String(initial.minimum))
  const [to, setTo] = useState(String(initial.maximum))
  const valid = [from, to].every((text) => text.trim() !== '' && Number.isFinite(Number(text)))
  const bounds = { min: limits.minimum, max: limits.maximum, step }
  const unitText = unit && ` (${unit})`
  return (
    <fieldset className="editor-random">
      <legend>{legend}</legend>
      <label className="editor-field">
        <span>{`${copy.rangeFrom}${unitText}`}</span>
        <input type="number" {...bounds} value={from} onChange={(event) => setFrom(event.currentTarget.value)} />
      </label>
      <label className="editor-field">
        <span>{`${copy.rangeTo}${unitText}`}</span>
        <input type="number" {...bounds} value={to} onChange={(event) => setTo(event.currentTarget.value)} />
      </label>
      <button
        className="text-button"
        type="button"
        disabled={!valid}
        onClick={() => onRandomize({ minimum: Number(from), maximum: Number(to) })}
      >
        {copy.randomize}
      </button>
    </fieldset>
  )
}

/** Edits every selected object at once. Each change is one undo step; a slider or color drag is one step too. */
export function BulkInspector({
  town,
  objects,
  copy,
  edit,
  onSelect,
  onRemove,
}: {
  town: TownSnapshot
  objects: readonly TownObject[]
  copy: Copy
  edit: Edit
  onSelect: (selection: EditorSelection) => void
  onRemove: (ids: readonly string[]) => void
}) {
  const ids = objects.map(({ id }) => id)
  const sharedType = getSharedValue(objects.map(({ type }) => type))
  const variants = sharedType ? TOWN_OBJECT_KINDS[sharedType].variants : undefined
  const sharedVariant = getSharedValue(objects.map(({ variant }) => variant ?? ''))
  // Roads are painted into the ground, so they neither turn nor scale.
  const turnable = objects.every(({ type }) => type !== 'road')
  const sky = objects.every(({ type }) => isSkyObject(type))
  const degrees = objects.map(({ rotation }) => Math.round(MathUtils.radToDeg(rotation)))
  const sharedDegrees = getSharedValue(degrees)
  const sharedScale = getSharedValue(objects.map(({ scale }) => scale))
  const blocks = getRemovalBlocks(town, ids)
  const keptCount = blocks.singleton.length + blocks['bench-in-use'].length
  return (
    <>
      <h3>{copy.selectedCount(objects.length)}</h3>
      <ColorField objects={objects} copy={copy} edit={edit} />
      {variants && (
        <SelectField
          label={copy.variant}
          value={sharedVariant ?? ''}
          mixedLabel={sharedVariant === undefined ? copy.mixed : undefined}
          options={[
            { value: '', label: copy.automaticVariant },
            ...variants.map((variant) => ({ value: variant, label: copy.variants[variant] })),
          ]}
          onChange={(variant) => edit((current) => setObjectsVariant(current, ids, variant || undefined))}
        />
      )}
      {turnable && (
        <>
          <RangeField
            label={sky ? copy.heading : copy.rotation}
            value={sharedDegrees ?? degrees[0]}
            valueText={sharedDegrees === undefined ? copy.mixed : undefined}
            min={ROTATION_LIMITS_IN_DEGREES.minimum}
            max={ROTATION_LIMITS_IN_DEGREES.maximum}
            step={5}
            unit="°"
            edit={edit}
            onChange={(value) => changeObjects(ids, { rotation: MathUtils.degToRad(value) })}
          />
          <RandomRangeFields
            legend={sky ? copy.randomHeading : copy.randomRotation}
            initial={ROTATION_LIMITS_IN_DEGREES}
            limits={ROTATION_LIMITS_IN_DEGREES}
            step={5}
            unit="°"
            copy={copy}
            onRandomize={(range) => edit((current) => randomizeRotations(current, ids, range))}
          />
          <RangeField
            label={copy.scale}
            value={sharedScale ?? objects[0].scale}
            valueText={sharedScale === undefined ? copy.mixed : undefined}
            min={SIZE_LIMITS.minimum}
            max={SIZE_LIMITS.maximum}
            step={0.05}
            unit="×"
            edit={edit}
            onChange={(scale) => changeObjects(ids, { scale })}
          />
          <RandomRangeFields
            legend={copy.randomSize}
            initial={{ minimum: 0.8, maximum: 1.2 }}
            limits={SIZE_LIMITS}
            step={0.05}
            copy={copy}
            onRandomize={(range) => edit((current) => randomizeSizes(current, ids, range))}
          />
        </>
      )}
      <div className="editor-actions">
        <button
          className="text-button"
          type="button"
          disabled={blocks.singleton.length === objects.length}
          onClick={() => {
            const copied = duplicateObjects(town, ids)
            edit(() => copied.town)
            onSelect(selectObjects(copied.ids))
          }}
        >
          {copy.duplicate}
        </button>
        <button
          className="text-button danger"
          type="button"
          disabled={keptCount === objects.length}
          onClick={() => onRemove(ids)}
        >
          {copy.remove}
        </button>
        <button className="text-button" type="button" onClick={() => onSelect(null)}>
          {copy.clearSelection}
        </button>
      </div>
      {removalNotes(blocks, copy).map((note) => (
        <p key={note} className="editor-note">
          {note}
        </p>
      ))}
    </>
  )
}

export function Inspector({
  town,
  selection,
  settingsShown,
  language,
  copy,
  dirty,
  detailsHidden,
  edit,
  onSelect,
  onShowTownSettings,
  onRemoveObjects,
  onToggleDetails,
  onViewBallpark,
}: {
  town: TownSnapshot
  selection: EditorSelection
  /** The town settings, opened from the toolbar while nothing is selected. */
  settingsShown: boolean
  language: AppLanguage
  /** Whether anything is unsaved; only a saved town offers to leave the editor to try its ballpark rules. */
  dirty: boolean
  copy: Copy
  /** Only a phone-sized screen offers hiding the details, to give the map more room. */
  detailsHidden: boolean
  edit: Edit
  onSelect: (selection: EditorSelection) => void
  onShowTownSettings: () => void
  onRemoveObjects: (ids: readonly string[]) => void
  onToggleDetails: () => void
  onViewBallpark: () => void
}) {
  const objects = getSelectedObjects(town, selection)
  const object = objects.length === 1 ? objects[0] : undefined
  const resident = selection?.kind === 'resident' ? town.residents.find(({ id }) => id === selection.id) : undefined
  const petWalk = selection?.kind === 'pet'
  const empty = !objects.length && !resident && !petWalk && !settingsShown
  const petWalkFields = (
    <PetWalkFields town={town} selection={selection} language={language} copy={copy} edit={edit} onSelect={onSelect} />
  )
  return (
    <aside
      className={`editor-panel editor-inspector ${empty ? 'is-empty' : ''}`}
      aria-label={settingsShown ? copy.townSettings : copy.inspectorTitle}
    >
      <button
        className="text-button editor-details-toggle"
        type="button"
        aria-expanded={!detailsHidden}
        onClick={onToggleDetails}
      >
        {detailsHidden ? copy.showDetails : copy.hideDetails}
      </button>
      <div className="editor-inspector-details">
        {object && (
          <ObjectInspector
            key={object.id}
            town={town}
            object={object}
            selection={selection?.kind === 'object' ? selection : { kind: 'object', id: object.id }}
            copy={copy}
            edit={edit}
            onSelect={onSelect}
          />
        )}
        {objects.length > 1 && (
          <BulkInspector
            town={town}
            objects={objects}
            copy={copy}
            edit={edit}
            onSelect={onSelect}
            onRemove={onRemoveObjects}
          />
        )}
        {resident && selection?.kind === 'resident' && (
          <ResidentInspector
            key={resident.id}
            town={town}
            resident={resident}
            selection={selection}
            language={language}
            copy={copy}
            edit={edit}
            onSelect={onSelect}
            onShowTownSettings={onShowTownSettings}
          />
        )}
        {petWalk && petWalkFields}
        {empty && <p className="editor-note">{copy.inspectorEmpty}</p>}
        {settingsShown && <h3>{copy.townSettings}</h3>}
        {settingsShown && <TownNameFields town={town} language={language} copy={copy} edit={edit} />}
        {settingsShown && petWalkFields}
        {settingsShown && <TownMovementFields town={town} language={language} copy={copy} edit={edit} />}
        {settingsShown && (
          <BallparkSettingsFields town={town} language={language} dirty={dirty} edit={edit} onView={onViewBallpark} />
        )}
      </div>
    </aside>
  )
}

/** What shows when a dialog's chunk fails to load (a deploy replaced it), leaving unsaved edits as they are. */
export function DialogChunkFailure({
  copy,
  onClose,
}: {
  copy: { title: string; close: string; unavailable: string }
  onClose: () => void
}) {
  return (
    <div className="panel-scrim guestbook-review-scrim" role="presentation">
      <section className="guestbook-review" role="alertdialog" aria-modal="true" aria-labelledby="dialog-chunk-failure">
        <CloseButton autoFocus onClick={onClose} label={copy.close} />
        <h2>{copy.title}</h2>
        <p id="dialog-chunk-failure">{copy.unavailable}</p>
      </section>
    </div>
  )
}

export function BoardReviewUnavailable({ language, onClose }: { language: AppLanguage; onClose: () => void }) {
  return <DialogChunkFailure copy={languageCopy[language].boardReview} onClose={onClose} />
}

export function UsageStatsUnavailable({ language, onClose }: { language: AppLanguage; onClose: () => void }) {
  return <DialogChunkFailure copy={languageCopy[language].usageStats} onClose={onClose} />
}

export function TownEditorPanel({
  language,
  editor,
  town,
  view,
  viewCenter,
  category,
  selecting,
  focusTargetRef,
  onViewChange,
  onCategoryChange,
  onSelectingChange,
  onSignOut,
}: {
  language: AppLanguage
  editor: TownEditor
  town: TownSnapshot
  view: EditorView
  viewCenter: MutableRefObject<Vector3>
  category: EditorCategory
  /** Touch select mode: a tap adds or removes a marker and a drag selects a box. */
  selecting: boolean
  /** Where the map camera glides next, set when something is chosen from a list. */
  focusTargetRef: MutableRefObject<Vec3 | null>
  onViewChange: (view: EditorView) => void
  onCategoryChange: (category: EditorCategory) => void
  onSelectingChange: (selecting: boolean) => void
  onSignOut: () => void
}) {
  const copy = languageCopy[language].editor
  const adminCopy = languageCopy[language].admin
  const { edit, selection, select, undo, notice } = editor
  const [dialog, setDialog] = useState<'guestbook' | 'board' | 'stats' | 'admins' | null>(null)
  const [detailsHidden, setDetailsHidden] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Choosing anything to edit, here or on the map, closes the town settings.
  if (settingsOpen && selection) setSettingsOpen(false)
  const settingsShown = settingsOpen && !selection
  const selectedResident =
    selection?.kind === 'resident' ? town.residents.find(({ id }) => id === selection.id) : undefined
  const problems = getLayoutProblems(town)
  const problem = problems[0]
  const status = saveStatusText(editor.dirty, town.revision, copy)

  const show = (next: EditorSelection) => {
    select(next)
    focusTargetRef.current = getFocusPoint(town, next)
  }
  const showTownSettings = () => {
    select(null)
    setSettingsOpen(true)
  }
  // Another tab's markers cannot be picked, so its selection goes.
  const changeCategory = (next: EditorCategory) => {
    if (next === category) return
    onCategoryChange(next)
    select(null)
  }
  const showProblem = (shown: LayoutProblem) => {
    const target = problemSelection(shown)
    if (!target) {
      showTownSettings()
      return
    }
    onCategoryChange(getSelectionCategory(town, target) ?? category)
    show(target)
  }
  // What the town needs stays selected, so the inspector keeps saying why.
  const removeSelectedObjects = (ids: readonly string[]) => {
    const blocks = getRemovalBlocks(town, ids)
    const kept = [...blocks.singleton, ...blocks['bench-in-use']]
    const question = [copy.deleteObjectsConfirm(ids.length - kept.length), ...removalNotes(blocks, copy)].join(' ')
    if (!window.confirm(question)) return
    edit((current) => removeObjects(current, ids))
    select(selectObjects(kept))
  }
  const removeSelection = () => {
    if (selection?.kind === 'resident') {
      edit((current) => removeResident(current, selection.id))
      select(null)
      return
    }
    const ids = getSelectedObjects(town, selection).map(({ id }) => id)
    if (ids.length > 1) {
      removeSelectedObjects(ids)
      return
    }
    edit((current) => removeObjects(current, ids))
    select(null)
  }

  useEffect(() => {
    if (notice !== 'saved') return
    const timer = window.setTimeout(editor.dismissNotice, 3000)
    return () => window.clearTimeout(timer)
  }, [editor.dismissNotice, notice])

  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return
    // The dialogs are modal, so editor shortcuts such as Delete must not reach the town behind them.
    if (dialog && event.key === 'Escape') setDialog(null)
    if (dialog) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      undo()
    }
    if (event.key === 'Escape') select(null)
    if (!selection || !isDeleteShortcut(event.key, selection, town)) return
    event.preventDefault()
    removeSelection()
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKey(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const placeAt = () => ({ x: viewCenter.current.x, y: 0, z: viewCenter.current.z })
  const addTownObject = (type: TownObjectType) => {
    const added = addObject(town, type, placeAt(), copy.newResident)
    edit(() => added.town)
    select({ kind: 'object', id: added.id })
  }
  const addTownResident = () => {
    const added = addResident(town, placeAt(), copy.newResident)
    if (!added.id) return
    edit(() => added.town)
    select({ kind: 'resident', id: added.id })
  }

  return (
    <div className={`editor-layer ${detailsHidden ? 'is-details-hidden' : ''}`}>
      <header className="editor-panel editor-toolbar">
        <div>
          <strong>{copy.title}</strong>
          <small role="status">{status}</small>
        </div>
        <div className="editor-actions">
          <button className="text-button" type="button" disabled={!editor.canUndo} onClick={undo}>
            {copy.undo}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={!editor.dirty}
            onClick={() => window.confirm(copy.discardConfirm) && editor.discard()}
          >
            {copy.discard}
          </button>
          <button
            className="primary-button editor-primary"
            type="button"
            disabled={!editor.dirty || editor.saving || Boolean(problem)}
            onClick={() => void editor.save()}
          >
            {editor.saving ? copy.saving : copy.save}
          </button>
          <button
            className="text-button"
            type="button"
            aria-pressed={settingsShown}
            onClick={() => (settingsShown ? setSettingsOpen(false) : showTownSettings())}
          >
            {copy.townSettings}
          </button>
          <button
            className="text-button"
            type="button"
            aria-pressed={view === 'visitor'}
            onClick={() => onViewChange(view === 'visitor' ? 'top' : 'visitor')}
          >
            {view === 'visitor' ? copy.topView : copy.visitorView}
          </button>
          <button className="text-button" type="button" onClick={() => setDialog('guestbook')}>
            {languageCopy[language].review.open}
          </button>
          <button className="text-button" type="button" onClick={() => setDialog('board')}>
            {languageCopy[language].boardReview.open}
          </button>
          <button className="text-button" type="button" onClick={() => setDialog('stats')}>
            {languageCopy[language].usageStats.open}
          </button>
          <button className="text-button" type="button" onClick={() => setDialog('admins')}>
            {languageCopy[language].admins.open}
          </button>
          <a className="text-button" href="/">
            {adminCopy.visitTown}
          </a>
          <button className="text-button" type="button" onClick={onSignOut}>
            {adminCopy.signOut}
          </button>
        </div>
      </header>
      <div className="editor-dock">
        <ObjectBrowser
          town={town}
          selection={selection}
          category={category}
          language={language}
          copy={copy}
          selecting={selecting}
          onCategoryChange={changeCategory}
          onSelectingChange={onSelectingChange}
          onSelect={select}
          onShow={show}
          onAdd={addTownObject}
          onAddResident={addTownResident}
        />
        <Inspector
          town={town}
          selection={selection}
          settingsShown={settingsShown}
          language={language}
          copy={copy}
          dirty={editor.dirty}
          detailsHidden={detailsHidden}
          edit={edit}
          onSelect={select}
          onShowTownSettings={showTownSettings}
          onRemoveObjects={removeSelectedObjects}
          onToggleDetails={() => setDetailsHidden(!detailsHidden)}
          onViewBallpark={() => {
            focusTargetRef.current = getVenueGatePoint('ballpark')
          }}
        />
      </div>
      {(notice || problem) && (
        <div className={`editor-notice ${notice && notice !== 'saved' ? 'is-error' : ''}`} role="alert">
          <p>{notice ? noticeMessage(notice, copy) : copy.problems[problem!.problem]}</p>
          {!notice && problem && (
            <button className="text-button" type="button" onClick={() => showProblem(problem)}>
              {copy.showProblem}
            </button>
          )}
          {notice === 'conflict' && (
            <button className="text-button" type="button" onClick={editor.retry}>
              {copy.reload}
            </button>
          )}
          {notice && notice !== 'saved' && (
            <button className="text-button" type="button" onClick={editor.dismissNotice}>
              {copy.dismiss}
            </button>
          )}
        </div>
      )}
      {selectedResident && (
        <ResidentPreview key={selectedResident.id} resident={selectedResident} language={language} />
      )}
      <p className="editor-panel editor-hint">
        <span className="editor-hint-pointer">{view === 'visitor' ? copy.visitorControls : copy.controls}</span>
        <span className="editor-hint-touch">{view === 'visitor' ? copy.touchVisitorControls : copy.touchControls}</span>
      </p>
      {dialog === 'guestbook' && <GuestbookReview language={language} onClose={() => setDialog(null)} />}
      {dialog === 'board' && (
        <Suspense fallback={null}>
          <BoardReview language={language} onClose={() => setDialog(null)} />
        </Suspense>
      )}
      {dialog === 'stats' && (
        <Suspense fallback={null}>
          <UsageStats language={language} onClose={() => setDialog(null)} />
        </Suspense>
      )}
      {dialog === 'admins' && <AdminEmails language={language} onClose={() => setDialog(null)} />}
    </div>
  )
}
