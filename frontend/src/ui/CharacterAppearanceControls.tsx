import {
  COLOR_CHOICES,
  PROFILE_CHOICES,
  type AppearanceField,
  type ColorField,
  type PlayerProfile,
} from '../data/playerProfile'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { ChoiceButtonGroup } from './ChoiceButtonGroup'

export interface ColorChoiceProps {
  language: AppLanguage
  field: ColorField
  value: string
  onChange: (color: string) => void
}

export function ColorChoice({ language, field, value, onChange }: ColorChoiceProps) {
  const choice = COLOR_CHOICES[field]
  const copy = languageCopy[language].creator
  const fieldLabel = copy.fields[field]

  return (
    <fieldset className="color-choice">
      <legend>{copy.colorLabel(fieldLabel)}</legend>
      <div className="color-swatches">
        {choice.presets.map(([label, color]) => (
          <button
            key={color}
            type="button"
            className="color-swatch"
            style={{ backgroundColor: color }}
            aria-label={copy.swatchLabel(fieldLabel, copy.colors[label])}
            aria-pressed={value === color}
            title={`${copy.colors[label]} ${color}`}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
      <label className="custom-color">
        {copy.customColorLabel(fieldLabel)}
        <input
          type="color"
          name={`${field}-color`}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <span>{value}</span>
      </label>
    </fieldset>
  )
}

export interface AppearanceSectionProps {
  language: AppLanguage
  field: AppearanceField
  profile: PlayerProfile
  onChoice: (choice: string) => void
  onColor: (color: string) => void
}

export function AppearanceSection({ language, field, profile, onChoice, onColor }: AppearanceSectionProps) {
  const choices = PROFILE_CHOICES[field]
  const colorField = field in COLOR_CHOICES ? (field as ColorField) : null
  const copy = languageCopy[language].creator
  const fieldLabel = copy.fields[field]

  return (
    <details className="creator-option">
      <summary>
        <span>{fieldLabel}</span>
        <strong>{copy.options[profile[field]]}</strong>
        {colorField && <i aria-hidden="true" style={{ backgroundColor: profile.colors[colorField] }} />}
      </summary>
      <div className="creator-option-content">
        <ChoiceButtonGroup
          ariaLabel={copy.optionsLabel(fieldLabel)}
          className="appearance-choices"
          name={field}
          options={choices.options}
          value={profile[field]}
          onChange={onChoice}
          getOptionLabel={(option) => copy.options[option]}
        />
        {colorField && (
          <ColorChoice language={language} field={colorField} value={profile.colors[colorField]} onChange={onColor} />
        )}
      </div>
    </details>
  )
}
