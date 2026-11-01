import type { Ref } from 'react'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import type { CameraStatus } from '../cameraTracking'
import type { BattingSide } from '../game/field'
import type { PanelSide } from './cameraPanelLayout'
import { StanceGauge } from './StanceGauge'

const BATTING_SIDES: readonly BattingSide[] = ['right', 'left']

/**
 * The camera game's setup card beside the camera panel's stage: what the camera is doing (asking, loading the pose
 * task, timing this computer), the promise about its picture, which side the visitor bats from (the batter, the
 * camera panel, and where a swing loads follow it), how the camera finds what the visitor swings by itself (or lets
 * them swing with their hands) once it follows them, and the way on once this computer has been timed fast enough:
 * holding the batting stance fills `gauge` and starts practice, as the "start practice" button does, while `stanceNeed`
 * under it says what the hold waits for. A camera problem takes its place with the cause and another try; there is no
 * other way to play. `cameraState` is the panel chip's words, which a screen reader hears from here.
 */
export function SetupView({
  status,
  cameraState,
  panelSide,
  side,
  gauge,
  stanceNeed,
  language,
  onSideChange,
  onStart,
  onRetry,
  onTurnOff,
}: {
  status: Exclude<CameraStatus, { kind: 'off' } | { kind: 'tooSlow' }>
  cameraState: string | null
  panelSide: PanelSide
  side: BattingSide
  gauge: Ref<HTMLDivElement>
  stanceNeed: string | null
  language: AppLanguage
  onSideChange: (side: BattingSide) => void
  onStart: () => void
  onRetry: () => void
  onTurnOff: () => void
}) {
  const copy = languageCopy[language].baseball
  if (status.kind === 'problem') {
    const problem = copy.camera.problems[status.problem]
    return (
      <section className="baseball-card" role="alert" aria-labelledby="derby-camera-title">
        <h1 id="derby-camera-title">{problem.title}</h1>
        <p className="baseball-note">{problem.description}</p>
        <div className="derby-actions">
          <button className="primary-button" type="button" autoFocus onClick={onRetry}>
            {copy.camera.tryAgain}
          </button>
        </div>
      </section>
    )
  }
  const following = status.kind === 'measuring' || status.kind === 'ready'
  return (
    <section className="baseball-card derby-setup" data-panel-side={panelSide} aria-labelledby="derby-camera-title">
      <h1 id="derby-camera-title">{copy.camera.setupTitle}</h1>
      <p className="derby-setup-status" role="status">
        {copy.camera.setup[status.kind]}
      </p>
      <p className="derby-camera-state" role="status">
        {cameraState}
      </p>
      <fieldset className="derby-side">
        <legend>{copy.camera.side.legend}</legend>
        {BATTING_SIDES.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="derby-batting-side"
              value={option}
              checked={side === option}
              onChange={() => onSideChange(option)}
            />
            {copy.camera.side[option]}
          </label>
        ))}
      </fieldset>
      {following && <p className="baseball-note">{copy.camera.lockHint}</p>}
      {status.kind === 'ready' && (
        <StanceGauge ref={gauge} label={copy.flow.stance} hint={copy.flow.toPractice} need={stanceNeed} />
      )}
      <p className="baseball-note">{copy.camera.notice}</p>
      <p className="baseball-note">{copy.camera.panelKey}</p>
      <div className="derby-actions">
        {status.kind === 'ready' && (
          <button className="primary-button" type="button" autoFocus onClick={onStart}>
            {copy.flow.startPractice}
          </button>
        )}
        <button className="derby-secondary" type="button" onClick={onTurnOff}>
          {copy.camera.turnOff}
        </button>
      </div>
    </section>
  )
}
