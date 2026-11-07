import { useState } from 'react'
import { fetchUsageStats, type UsageStats as Stats } from '../data/usageStatsApi'
import { useRetryableLoad } from '../hooks/useRetryableLoad'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { CloseButton } from '../ui/CloseButton'
import './usageStats.css'
import { usageStatsCopy, type UsageStatsCopy } from './usageStatsCopy'
import {
  axisTop,
  dailyRows,
  dayLabel,
  eventTotal,
  isEmptyStats,
  largestDailyCount,
  stepTotal,
  STEPS,
  type DailyRow,
  type Step,
} from './usageStatsView'

const ALWAYS_LISTED_EVENTS = [
  'resident-talk',
  'contact-opened',
  'linkedin-opened',
  'map-opened',
  'photo-taken',
] as const

/** A bar from one baseline, its value at the tip, in room left for the value at the longest. */
export function ValueBar({ value, largest }: { value: number; largest: number }) {
  return (
    <span className="usage-bar-track">
      {value > 0 && <span className="usage-bar" style={{ width: `calc((100% - 4em) * ${value / largest})` }} />}
      <span className="usage-bar-value">{value}</span>
    </span>
  )
}

/** The steps as totals, with nothing between them: nothing follows anyone from one step to the next. */
export function StepTotals({ rows, copy }: { rows: readonly DailyRow[]; copy: UsageStatsCopy }) {
  const totals = STEPS.map((step) => ({ step, total: stepTotal(rows, step) }))
  const largest = Math.max(1, ...totals.map(({ total }) => total))
  return (
    <section className="usage-stats-section" aria-labelledby="usage-steps-title">
      <h3 id="usage-steps-title">{copy.stepsTitle}</h3>
      <ol className="usage-bars">
        {totals.map(({ step, total }) => (
          <li className="usage-bar-row" key={step}>
            <span>{copy.steps[step]}</span>
            <ValueBar value={total} largest={largest} />
          </li>
        ))}
      </ol>
      <p className="editor-note">{copy.notesNote}</p>
    </section>
  )
}

/** One step's days as columns on the shared axis; the whole of a day's slot answers the pointer. */
export function DailyColumns({
  rows,
  step,
  top,
  shownDay,
  language,
  copy,
  onPoint,
}: {
  rows: readonly DailyRow[]
  step: Step
  top: number
  shownDay: string
  language: AppLanguage
  copy: UsageStatsCopy
  onPoint: (day: string | null) => void
}) {
  const first = rows[0]
  const last = rows[rows.length - 1]
  return (
    <figure className="usage-panel">
      <figcaption className="usage-panel-head">
        <strong>{copy.steps[step]}</strong>
        <span aria-hidden="true">{top}</span>
      </figcaption>
      <div
        className="usage-columns"
        role="img"
        aria-label={copy.chartLabel(copy.steps[step], stepTotal(rows, step))}
        onPointerLeave={() => onPoint(null)}
      >
        {rows.map(({ day, counts }) => (
          <span
            key={day}
            className={`usage-column ${day === shownDay ? 'is-shown' : ''}`}
            onPointerEnter={() => onPoint(day)}
          >
            {counts[step] > 0 && <i style={{ height: `${(counts[step] / top) * 100}%` }} />}
          </span>
        ))}
      </div>
      <div className="usage-panel-axis" aria-hidden="true">
        <span>{first && dayLabel(first.day, language)}</span>
        <span>{last && dayLabel(last.day, language)}</span>
      </div>
    </figure>
  )
}

/** The same numbers for anyone who cannot point at a column, or wants them all. */
export function DailyTable({
  rows,
  language,
  copy,
}: {
  rows: readonly DailyRow[]
  language: AppLanguage
  copy: UsageStatsCopy
}) {
  return (
    <details className="usage-table">
      <summary>{copy.table}</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">{copy.day}</th>
            {STEPS.map((step) => (
              <th scope="col" key={step}>
                {copy.steps[step]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ day, counts }) => (
            <tr key={day}>
              <td>{dayLabel(day, language)}</td>
              {STEPS.map((step) => (
                <td key={step}>{counts[step]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/** Every step's days at one scale, side by side, and one readout of the day being pointed at, today until then. */
export function DailyTrend({
  rows,
  language,
  copy,
}: {
  rows: readonly DailyRow[]
  language: AppLanguage
  copy: UsageStatsCopy
}) {
  const [pointedDay, setPointedDay] = useState<string | null>(null)
  const shown = rows.find(({ day }) => day === pointedDay) ?? rows[rows.length - 1]
  const top = axisTop(largestDailyCount(rows))
  if (!shown) return null
  return (
    <section className="usage-stats-section" aria-labelledby="usage-daily-title">
      <h3 id="usage-daily-title">{copy.dailyTitle}</h3>
      <p className="editor-note">{copy.dailyNote}</p>
      <p className="usage-readout" aria-hidden="true">
        <strong>{dayLabel(shown.day, language)}</strong>
        {STEPS.map((step) => ` · ${copy.steps[step]} ${shown.counts[step]}`).join('')}
      </p>
      <div className="usage-panels">
        {STEPS.map((step) => (
          <DailyColumns
            key={step}
            rows={rows}
            step={step}
            top={top}
            shownDay={shown.day}
            language={language}
            copy={copy}
            onPoint={setPointedDay}
          />
        ))}
      </div>
      <DailyTable rows={rows} language={language} copy={copy} />
    </section>
  )
}

export function CountTiles({ stats, copy }: { stats: Stats; copy: UsageStatsCopy }) {
  const ballparkEntries = eventTotal(stats, 'ballpark-entered')
  return (
    <section className="usage-stats-section" aria-labelledby="usage-others-title">
      <h3 id="usage-others-title">{copy.othersTitle}</h3>
      <dl className="usage-tiles">
        {ALWAYS_LISTED_EVENTS.map((event) => (
          <div key={event}>
            <dt>{copy.others[event]}</dt>
            <dd>{eventTotal(stats, event)}</dd>
          </div>
        ))}
        {ballparkEntries > 0 && (
          <div>
            <dt>{copy.others['ballpark-entered']}</dt>
            <dd>{ballparkEntries}</dd>
          </div>
        )}
        <div>
          <dt>{copy.pending}</dt>
          <dd>{stats.guestbook.byStatus.pending}</dd>
        </div>
        <div>
          <dt>{copy.approved}</dt>
          <dd>{stats.guestbook.byStatus.approved}</dd>
        </div>
      </dl>
    </section>
  )
}

export function ResidentRanking({ residents, copy }: { residents: Stats['residents']; copy: UsageStatsCopy }) {
  const largest = Math.max(0, ...residents.map(({ conversations }) => conversations))
  return (
    <section className="usage-stats-section" aria-labelledby="usage-residents-title">
      <h3 id="usage-residents-title">{copy.residentsTitle}</h3>
      {largest === 0 && <p className="editor-note">{copy.residentsEmpty}</p>}
      {largest > 0 && (
        <ol className="usage-bars">
          {residents.map(({ id, name, conversations }) => (
            <li className="usage-bar-row" key={id}>
              <bdi>{name ?? copy.removedResident(id)}</bdi>
              <ValueBar value={conversations} largest={largest} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function DerbyMonths({ months, copy }: { months: Stats['derby']; copy: UsageStatsCopy }) {
  return (
    <section className="usage-stats-section" aria-labelledby="usage-derby-title">
      <h3 id="usage-derby-title">{copy.derbyTitle}</h3>
      <div className="usage-table">
        <table>
          <thead>
            <tr>
              <th scope="col">{copy.month}</th>
              <th scope="col">{copy.runs}</th>
              <th scope="col">{copy.records}</th>
            </tr>
          </thead>
          <tbody>
            {months.map(({ month, runs, records }) => (
              <tr key={month}>
                <td>{month}</td>
                <td>{runs}</td>
                <td>{records}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="editor-note">{copy.derbyNote}</p>
    </section>
  )
}

export function UsageStatsBody({
  stats,
  language,
  copy,
}: {
  stats: Stats
  language: AppLanguage
  copy: UsageStatsCopy
}) {
  const rows = dailyRows(stats)
  return (
    <>
      <p className="editor-note">
        {copy.range(dayLabel(stats.range.from, language), dayLabel(stats.range.to, language))}
      </p>
      {isEmptyStats(stats) && <p role="status">{copy.empty}</p>}
      {!isEmptyStats(stats) && <StepTotals rows={rows} copy={copy} />}
      {!isEmptyStats(stats) && <DailyTrend rows={rows} language={language} copy={copy} />}
      {!isEmptyStats(stats) && <ResidentRanking residents={stats.residents} copy={copy} />}
      {!isEmptyStats(stats) && <CountTiles stats={stats} copy={copy} />}
      {stats.derby.length > 0 && <DerbyMonths months={stats.derby} copy={copy} />}
    </>
  )
}

/** Anonymous totals of what people do inside the town. Nothing here identifies anyone. */
export function UsageStats({ language, onClose }: { language: AppLanguage; onClose: () => void }) {
  const copy = usageStatsCopy[language]
  const shellCopy = languageCopy[language].usageStats
  const { status, latest, retry } = useRetryableLoad(fetchUsageStats)
  return (
    <div
      className="panel-scrim guestbook-review-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="guestbook-review usage-stats"
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-stats-title"
      >
        <CloseButton autoFocus onClick={onClose} label={shellCopy.close} />
        <h2 id="usage-stats-title">{shellCopy.title}</h2>
        <p className="editor-note">{copy.intro}</p>
        <p className="editor-note">{copy.caveat}</p>
        {status === 'loading' && !latest && <p role="status">{copy.loading}</p>}
        {status === 'error' && (
          <p role="alert">
            {copy.loadError}{' '}
            <button className="text-button" type="button" onClick={retry}>
              {copy.retry}
            </button>
          </p>
        )}
        {latest && <UsageStatsBody stats={latest} language={language} copy={copy} />}
      </section>
    </div>
  )
}
