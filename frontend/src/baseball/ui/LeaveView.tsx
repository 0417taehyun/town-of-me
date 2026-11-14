import { type AppLanguage, languageCopy } from '../../i18n/language'

/**
 * Asked before the page's own exits (the back links, Escape) while a record this visit made is not posted: it is on
 * neither the board nor the statues until it is, so the visitor posts it or leaves anyway. Escape stays.
 */
export function LeaveView({
  language,
  onPost,
  onLeave,
}: {
  language: AppLanguage
  onPost: () => void
  onLeave: () => void
}) {
  const copy = languageCopy[language].baseball.board
  return (
    <>
      <div className="derby-leave-scrim" aria-hidden="true" />
      <section
        className="baseball-card derby-leave"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="derby-leave-title"
        aria-describedby="derby-leave-text"
      >
        <h1 id="derby-leave-title">{copy.leaveTitle}</h1>
        <p id="derby-leave-text">{copy.leaveText}</p>
        <div className="derby-actions">
          <button className="primary-button" type="button" autoFocus onClick={onPost}>
            {copy.list}
          </button>
          <button className="derby-secondary" type="button" onClick={onLeave}>
            {copy.leaveAnyway}
          </button>
        </div>
      </section>
    </>
  )
}
