import { type AppLanguage, languageCopy } from '../../i18n/language'
import type { CameraStatus } from '../cameraTracking'
import type { PanelSide } from './cameraPanelLayout'

/**
 * The camera game's setup card beside the camera panel's stage: what the camera is doing (asking, loading the pose
 * task, timing this computer), the promise about its picture, how to lock what the visitor swings (or play without an
 * object) once the camera follows them, and the way on: play once this computer has been timed fast enough, or turn
 * the camera off. A camera problem takes its place with the cause and another try; there is no other way to play.
 * `cameraState` is the panel chip's words, which a screen reader hears from here. The lock button is the keyboard's way
 * to do what tapping the camera picture does.
 */
export function SetupView({
  status,
  cameraState,
  panelSide,
  freeMode,
  language,
  onPlay,
  onRetry,
  onTurnOff,
  onLockHeld,
  onToggleFreeMode,
}: {
  status: Exclude<CameraStatus, { kind: 'off' } | { kind: 'tooSlow' }>
  cameraState: string | null
  panelSide: PanelSide
  freeMode: boolean
  language: AppLanguage
  onPlay: () => void
  onRetry: () => void
  onTurnOff: () => void
  onLockHeld: () => void
  onToggleFreeMode: () => void
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
      {following && (
        <div className="derby-lock">
          <p className="baseball-note">{copy.camera.lockHint}</p>
          <div className="derby-actions">
            {!freeMode && (
              <button className="derby-secondary" type="button" onClick={onLockHeld}>
                {copy.camera.lockHeld}
              </button>
            )}
            <button className="derby-secondary" type="button" aria-pressed={freeMode} onClick={onToggleFreeMode}>
              {copy.camera.freeMode}
            </button>
          </div>
        </div>
      )}
      <p className="baseball-note">{copy.camera.notice}</p>
      <p className="baseball-note">{copy.camera.panelKey}</p>
      <div className="derby-actions">
        {status.kind === 'ready' && (
          <button className="primary-button" type="button" autoFocus onClick={onPlay}>
            {copy.play}
          </button>
        )}
        <button className="derby-secondary" type="button" onClick={onTurnOff}>
          {copy.camera.turnOff}
        </button>
      </div>
    </section>
  )
}
