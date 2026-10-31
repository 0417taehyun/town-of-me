import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { TownObject, TownObjectType, TownSnapshot } from '../data/models'
import type { AppLanguage, languageCopy } from '../i18n/language'
import { TOWN_OBJECT_KINDS } from '../scene/objects/kinds'
import { objectRowLabel, objectVariantLabel } from './editorPanelText'
import {
  addToObjectSelection,
  EDITOR_CATEGORIES,
  getCategoryTypes,
  getListedType,
  getListRange,
  getSelectedObjectIds,
  selectObjects,
  toggleObjectSelection,
  type EditorCategory,
} from './objectSelection'
import { PET_SELECTION, type EditorSelection } from './townEditing'

type Copy = (typeof languageCopy)[AppLanguage]['editor']

/** On a phone the list starts hidden to leave the map room; wider screens always show it. */
export function ListToggle({ shown, copy, onToggle }: { shown: boolean; copy: Copy; onToggle: () => void }) {
  return (
    <button className="text-button editor-list-toggle" type="button" aria-expanded={shown} onClick={onToggle}>
      {shown ? copy.hideList : copy.showList}
    </button>
  )
}

export function ObjectRow({
  object,
  label,
  variant,
  selected,
  copy,
  onChoose,
}: {
  object: TownObject
  label: string
  variant: string | null
  selected: boolean
  copy: Copy
  /** The checkbox adds or removes the row; the row itself selects only it, unless Shift or ⌘/Ctrl is held. */
  onChoose: (event: MouseEvent, fromCheckbox: boolean) => void
}) {
  return (
    <li className={selected ? 'is-selected' : undefined} data-object-id={object.id}>
      <button
        className="editor-row-check"
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={copy.selectRow(label)}
        onClick={(event) => onChoose(event, true)}
      />
      <button className="editor-row" type="button" title={object.id} onClick={(event) => onChoose(event, false)}>
        <span
          className="editor-swatch"
          style={{ background: object.color ?? TOWN_OBJECT_KINDS[object.type].defaultColor }}
          aria-hidden="true"
        />
        <span>{label}</span>
        {variant && <small>{variant}</small>}
      </button>
    </li>
  )
}

/** One tab of objects: its kinds with their counts, the chosen kind's add button, and the list of its objects. */
export function KindBrowser({
  town,
  selection,
  category,
  copy,
  selecting,
  listShown,
  onToggleList,
  onSelectingChange,
  onSelect,
  onShow,
  onAdd,
}: {
  town: TownSnapshot
  selection: EditorSelection
  category: EditorCategory
  copy: Copy
  selecting: boolean
  listShown: boolean
  onToggleList: () => void
  onSelectingChange: (selecting: boolean) => void
  onSelect: (selection: EditorSelection) => void
  onShow: (selection: EditorSelection) => void
  onAdd: (type: TownObjectType) => void
}) {
  const types = getCategoryTypes(category)
  const [chosenType, setChosenType] = useState(() => getListedType(town, selection, types) ?? types[0])
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [shownSelection, setShownSelection] = useState(selection)
  // An object picked on the map opens its kind's list.
  if (shownSelection !== selection) {
    setShownSelection(selection)
    setChosenType(getListedType(town, selection, types) ?? chosenType)
  }
  const list = useRef<HTMLUListElement>(null)
  const objects = town.objects.filter(({ type }) => type === chosenType)
  const ids = objects.map(({ id }) => id)
  const selectedIds = new Set(getSelectedObjectIds(selection))
  const singleId = selection?.kind === 'object' ? selection.id : null

  useEffect(() => {
    if (!singleId) return
    list.current?.querySelector(`[data-object-id="${CSS.escape(singleId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [singleId])

  const choose = (id: string, event: MouseEvent, fromCheckbox: boolean) => {
    setAnchorId(id)
    if (event.shiftKey) {
      onSelect(addToObjectSelection(selection, getListRange(ids, anchorId, id)))
      return
    }
    if (fromCheckbox || event.metaKey || event.ctrlKey) {
      onSelect(toggleObjectSelection(selection, id))
      return
    }
    onShow({ kind: 'object', id })
  }

  return (
    <>
      <div className="editor-chips" role="group" aria-label={copy.kindsLabel}>
        {types.map((type) => (
          <button key={type} type="button" aria-pressed={type === chosenType} onClick={() => setChosenType(type)}>
            {copy.types[type]}
            <span className="editor-count">{town.objects.filter((object) => object.type === type).length}</span>
          </button>
        ))}
      </div>
      <div className="editor-actions">
        {TOWN_OBJECT_KINDS[chosenType].addable && (
          <button className="text-button" type="button" onClick={() => onAdd(chosenType)}>
            {copy.addLabel(copy.types[chosenType])}
          </button>
        )}
        <button
          className="text-button"
          type="button"
          disabled={!ids.length || ids.every((id) => selectedIds.has(id))}
          onClick={() => onSelect(selectObjects(ids))}
        >
          {copy.selectAll(ids.length)}
        </button>
        <button
          className="text-button editor-select-mode"
          type="button"
          aria-pressed={selecting}
          onClick={() => onSelectingChange(!selecting)}
        >
          {copy.selectMode}
        </button>
        <ListToggle shown={listShown} copy={copy} onToggle={onToggleList} />
      </div>
      {selecting && <p className="editor-note editor-select-hint">{copy.selectModeHint}</p>}
      <ul className="editor-list" ref={list} aria-label={copy.objectList(copy.types[chosenType])}>
        {objects.map((object, index) => (
          <ObjectRow
            key={object.id}
            object={object}
            label={objectRowLabel(object, index + 1, copy)}
            variant={objectVariantLabel(object, copy)}
            selected={selectedIds.has(object.id)}
            copy={copy}
            onChoose={(event, fromCheckbox) => choose(object.id, event, fromCheckbox)}
          />
        ))}
      </ul>
      {!objects.length && <p className="editor-note editor-list-empty">{copy.listEmpty}</p>}
    </>
  )
}

/** The residents, the owner's marked, and the pet's walk; choosing one selects it and shows it on the map. */
export function PeopleBrowser({
  town,
  selection,
  language,
  copy,
  listShown,
  onToggleList,
  onShow,
  onAddResident,
}: {
  town: TownSnapshot
  selection: EditorSelection
  language: AppLanguage
  copy: Copy
  listShown: boolean
  onToggleList: () => void
  onShow: (selection: EditorSelection) => void
  onAddResident: () => void
}) {
  const selectedResidentId = selection?.kind === 'resident' ? selection.id : null
  return (
    <>
      <div className="editor-actions">
        <button className="text-button" type="button" onClick={onAddResident}>
          {copy.addResident}
        </button>
        <ListToggle shown={listShown} copy={copy} onToggle={onToggleList} />
      </div>
      <ul className="editor-list" aria-label={copy.residents}>
        {town.residents.map((resident) => (
          <li key={resident.id} className={resident.id === selectedResidentId ? 'is-selected' : undefined}>
            <button
              className="editor-row"
              type="button"
              aria-pressed={resident.id === selectedResidentId}
              onClick={() => onShow({ kind: 'resident', id: resident.id })}
            >
              <span>{resident.name}</span>
              {town.owner.residentId === resident.id && <small className="editor-badge">{copy.ownerBadge}</small>}
            </button>
          </li>
        ))}
        <li className={selection?.kind === 'pet' ? 'is-selected' : undefined}>
          <button
            className="editor-row"
            type="button"
            aria-pressed={selection?.kind === 'pet'}
            onClick={() => onShow(PET_SELECTION)}
          >
            <span>{copy.petWalk(town.pet.name[language])}</span>
          </button>
        </li>
      </ul>
    </>
  )
}

/** The left panel: category tabs, then the open tab's kinds and lists. */
export function ObjectBrowser({
  town,
  selection,
  category,
  language,
  copy,
  selecting,
  onCategoryChange,
  onSelectingChange,
  onSelect,
  onShow,
  onAdd,
  onAddResident,
}: {
  town: TownSnapshot
  selection: EditorSelection
  category: EditorCategory
  language: AppLanguage
  copy: Copy
  selecting: boolean
  onCategoryChange: (category: EditorCategory) => void
  onSelectingChange: (selecting: boolean) => void
  onSelect: (selection: EditorSelection) => void
  /** Selects from a list and moves the camera to it. */
  onShow: (selection: EditorSelection) => void
  onAdd: (type: TownObjectType) => void
  onAddResident: () => void
}) {
  const [listShown, setListShown] = useState(false)
  const toggleList = () => setListShown(!listShown)
  return (
    <aside className={`editor-panel editor-browser ${listShown ? 'is-list-shown' : ''}`} aria-label={copy.browserTitle}>
      <div className="editor-tabs" role="group" aria-label={copy.categoriesLabel}>
        {EDITOR_CATEGORIES.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={choice === category}
            onClick={() => onCategoryChange(choice)}
          >
            {copy.categories[choice]}
          </button>
        ))}
      </div>
      {category === 'people' ? (
        <PeopleBrowser
          town={town}
          selection={selection}
          language={language}
          copy={copy}
          listShown={listShown}
          onToggleList={toggleList}
          onShow={onShow}
          onAddResident={onAddResident}
        />
      ) : (
        <KindBrowser
          key={category}
          town={town}
          selection={selection}
          category={category}
          copy={copy}
          selecting={selecting}
          listShown={listShown}
          onToggleList={toggleList}
          onSelectingChange={onSelectingChange}
          onSelect={onSelect}
          onShow={onShow}
          onAdd={onAdd}
        />
      )}
    </aside>
  )
}
