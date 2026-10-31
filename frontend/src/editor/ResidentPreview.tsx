import { useState } from 'react'
import type { TownResident } from '../data/models'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { CharacterPreviewCanvas } from '../ui/CharacterPreviewCanvas'

/** Shows the selected resident up close, so appearance edits can be judged while choosing them. */
export function ResidentPreview({ resident, language }: { resident: TownResident; language: AppLanguage }) {
  const copy = languageCopy[language]
  const [degrees, setDegrees] = useState(0)
  return (
    <aside className="editor-panel editor-preview" aria-label={copy.editor.residentPreview(resident.name)}>
      <strong>{resident.name}</strong>
      <div className="editor-preview-canvas">
        <CharacterPreviewCanvas profile={resident.profile} degrees={degrees} />
      </div>
      <label className="editor-field">
        <span>{copy.creator.turnPreview}</span>
        <input
          type="range"
          min="-180"
          max="180"
          value={degrees}
          onChange={(event) => setDegrees(Number(event.currentTarget.value))}
        />
      </label>
    </aside>
  )
}
