import type { MusicStatus } from '../audio/cozyMusic'
import type { GuidedHudControl } from '../data/townGuide'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { dayPeriods, type DayPeriod } from '../scene/environment/dayCycle'
import type { Season } from '../scene/environment/season'
import { CloseButton } from './CloseButton'
import { LanguageSelect } from './LanguageSelect'
import { OwnerContactLink } from './OwnerIntroduction'

const seasons: readonly Season[] = ['spring', 'summer', 'autumn', 'winter']
const periods = Object.keys(dayPeriods) as DayPeriod[]

export interface HudProps {
  language: AppLanguage
  playerName: string
  townName: string
  /** The town owner's name in `language`. */
  ownerName: string
  /** Shows the contact button when set. */
  contactEmail: string | null
  interacted: boolean
  environmentOpen: boolean
  helpOpen: boolean
  mapOpen: boolean
  debug: boolean
  soundEnabled: boolean
  soundStatus: MusicStatus
  periodLabel: string
  seasonLabel: string
  previewingEnvironment: boolean
  /** The button the town guide is pointing at, marked so a first-time visitor finds it. */
  guidedControl: GuidedHudControl | null
  onCharacter: () => void
  onEnvironment: () => void
  onHelp: () => void
  onMap: () => void
  onPhoto: () => void
  onSound: () => void
  onLanguageChange: (language: AppLanguage) => void
}

export function Hud({
  language,
  playerName,
  onCharacter,
  townName,
  ownerName,
  contactEmail,
  interacted,
  environmentOpen,
  helpOpen,
  mapOpen,
  debug,
  soundEnabled,
  soundStatus,
  periodLabel,
  seasonLabel,
  previewingEnvironment,
  guidedControl,
  onEnvironment,
  onHelp,
  onMap,
  onPhoto,
  onSound,
  onLanguageChange,
}: HudProps) {
  const copy = languageCopy[language].hud
  const guided = (control: GuidedHudControl) => (guidedControl === control ? 'is-guided' : '')
  return (
    <>
      <div className="town-chip">
        <span className="town-mark" aria-hidden="true">
          ✦
        </span>
        <span>
          <small>
            {periodLabel} · {seasonLabel} · {previewingEnvironment ? copy.preview : copy.localTime}
          </small>
          {townName}
        </span>
      </div>
      {contactEmail && (
        <OwnerContactLink language={language} ownerName={ownerName} email={contactEmail} className="hud-contact" />
      )}
      <nav className="hud-actions" aria-label={copy.controlsLabel}>
        <LanguageSelect language={language} className="hud-language-select" onChange={onLanguageChange} />
        <button
          className={`icon-button player-button ${guided('character')}`}
          type="button"
          onClick={onCharacter}
          aria-label={`${copy.editCharacter}: ${playerName}`}
          title={`${copy.editCharacter}: ${playerName}`}
        >
          <span aria-hidden="true">🪞</span>
        </button>
        <button
          className={`icon-button sound-toggle ${soundEnabled ? '' : 'is-muted'}`}
          type="button"
          aria-label={soundEnabled ? copy.musicOff : copy.musicOn}
          aria-pressed={soundEnabled}
          data-music-control
          onClick={onSound}
        >
          <span aria-hidden="true">♫</span>
        </button>
        <button className="icon-button" type="button" aria-label={copy.help} aria-pressed={helpOpen} onClick={onHelp}>
          ?
        </button>
        <button
          className={`icon-button ${guided('photo')}`}
          type="button"
          aria-label={copy.takePhoto}
          title={copy.takePhoto}
          onClick={onPhoto}
        >
          <span aria-hidden="true">📷</span>
        </button>
        <button
          className={`icon-button ${guided('environment')}`}
          type="button"
          aria-label={copy.environment}
          aria-pressed={environmentOpen}
          onClick={onEnvironment}
        >
          <span aria-hidden="true">🌤️</span>
        </button>
        <button className="icon-button" type="button" aria-label={copy.map} aria-pressed={mapOpen} onClick={onMap}>
          <span aria-hidden="true">🗺️</span>
        </button>
      </nav>
      {!environmentOpen && !helpOpen && !mapOpen && (soundStatus === 'blocked' || soundStatus === 'unavailable') && (
        <p className="audio-hint" role="status">
          {soundStatus === 'blocked' ? copy.musicPaused : copy.audioUnavailable}
        </p>
      )}
      <div className={`movement-hint ${interacted ? 'is-quiet' : ''}`}>
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd>
        </span>
        <span>{copy.holdToRun}</span>
        <i aria-hidden="true" />
        <span>{copy.dragToGlance}</span>
        <i aria-hidden="true" />
        <span>
          <kbd>Wheel</kbd> {copy.wheelToZoom}
        </span>
        <i aria-hidden="true" />
        <span>
          <kbd>C</kbd> {copy.captureHint}
        </span>
      </div>
      {debug && (
        <div className="debug-badge">
          <strong>{copy.debugView}</strong>
          <span>{copy.debugHelp}</span>
        </div>
      )}
    </>
  )
}

export interface EnvironmentTunerProps {
  language: AppLanguage
  period: DayPeriod | 'local'
  season: Season | 'local'
  activePeriod: DayPeriod
  activeSeason: Season
  onPeriodChange: (period: DayPeriod | 'local') => void
  onSeasonChange: (season: Season | 'local') => void
  onReset: () => void
  onClose: () => void
}

export function EnvironmentTuner({
  language,
  period,
  season,
  activePeriod,
  activeSeason,
  onPeriodChange,
  onSeasonChange,
  onReset,
  onClose,
}: EnvironmentTunerProps) {
  const copy = languageCopy[language]
  return (
    <aside className="drawer" role="dialog" aria-labelledby="environment-title">
      <header className="drawer-header">
        <div>
          <p className="eyebrow">{copy.environment.eyebrow}</p>
          <h2 id="environment-title">{copy.environment.title}</h2>
        </div>
        <CloseButton autoFocus onClick={onClose} label={copy.environment.close} />
      </header>
      <p className="drawer-intro">{copy.environment.intro}</p>
      <div className="environment-fields">
        <label>
          <strong>{copy.environment.time}</strong>
          <select
            aria-label={copy.environment.timeSelect}
            value={period}
            onChange={(event) => onPeriodChange(event.currentTarget.value as DayPeriod | 'local')}
          >
            <option value="local">{copy.environment.localTime}</option>
            {periods.map((value) => (
              <option key={value} value={value}>
                {copy.periods[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <strong>{copy.environment.season}</strong>
          <select
            aria-label={copy.environment.seasonSelect}
            value={season}
            onChange={(event) => onSeasonChange(event.currentTarget.value as Season | 'local')}
          >
            <option value="local">{copy.environment.localSeason}</option>
            {seasons.map((value) => (
              <option key={value} value={value}>
                {copy.seasons[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="environment-preview" role="status">
        {copy.environment.showing} {copy.periods[activePeriod]} · {copy.seasons[activeSeason]}
      </p>
      <div className="drawer-actions">
        <button className="primary-button compact" type="button" onClick={onReset}>
          {copy.environment.reset}
        </button>
      </div>
      <p className="memory-note">
        <span aria-hidden="true">◌</span> {copy.environment.note}
      </p>
    </aside>
  )
}

export interface HelpPanelProps {
  language: AppLanguage
  /** The town's pet name in `language`. */
  petName: string
  onClose: () => void
  ambientMotion: boolean
  onAmbientMotion: (enabled: boolean) => void
}

export function HelpPanel({ language, petName, onClose, ambientMotion, onAmbientMotion }: HelpPanelProps) {
  const copy = languageCopy[language].help
  return (
    <div
      className="panel-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <CloseButton onClick={onClose} label={copy.close} />
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2 id="help-title">{copy.title}</h2>
        <p>{copy.intro}</p>
        <dl className="controls-grid">
          <div>
            <dt>
              <kbd>WASD</kbd> <kbd>↑↓←→</kbd>
            </dt>
            <dd>{copy.walk}</dd>
          </div>
          <div>
            <dt>
              <kbd>Shift</kbd>
            </dt>
            <dd>{copy.sprint}</dd>
          </div>
          <div>
            <dt>
              <kbd>{copy.runKey}</kbd>
            </dt>
            <dd>{copy.run}</dd>
          </div>
          <div>
            <dt>
              <kbd>Drag</kbd>
            </dt>
            <dd>{copy.glance}</dd>
          </div>
          <div>
            <dt>
              <kbd>E</kbd>
            </dt>
            <dd>{copy.interact(petName)}</dd>
          </div>
          <div>
            <dt>
              <kbd>{copy.touchKey}</kbd>
            </dt>
            <dd>{copy.touch}</dd>
          </div>
          <div>
            <dt>
              <kbd>Wheel</kbd>
            </dt>
            <dd>{copy.wheel}</dd>
          </div>
          <div>
            <dt>
              <kbd>H</kbd> / <kbd>R</kbd>
            </dt>
            <dd>{copy.debug}</dd>
          </div>
          <div>
            <dt>
              <kbd>C</kbd>
            </dt>
            <dd>{copy.photo}</dd>
          </div>
        </dl>
        <p>{copy.clock}</p>
        <p>{copy.character(petName)}</p>
        <p>{copy.appearance}</p>
        <label className="ambient-control">
          <input
            type="checkbox"
            checked={ambientMotion}
            onChange={(event) => onAmbientMotion(event.currentTarget.checked)}
          />{' '}
          {copy.ambient}
        </label>
        <p>{copy.ambientDescription}</p>
        <p className="help-tip">
          <strong>{copy.tipLabel}</strong> {copy.tip}
        </p>
      </section>
    </div>
  )
}
