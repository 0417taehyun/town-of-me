import type { CSSProperties, Ref } from 'react'
import { textEms } from './derbyCues'

/**
 * The ring that fills while the visitor holds the batting stance (named by `label`), with beside it the line of what
 * the hold waits for (`need`: the first thing the stance lacks, or to keep holding), both read from where the visitor
 * bats, and under them what holding starts (`hint`). The vision loop fills the ring straight on the element
 * (`--stance-progress`, 0..1, and `aria-valuenow`) whenever the hold changes, so React never renders for it
 * (BaseballApp.tsx), only when the line changes. Holding is one way on; the step's button by it is the other.
 */
export function StanceGauge({
  ref,
  label,
  hint,
  need,
}: {
  ref: Ref<HTMLDivElement>
  label: string
  hint: string
  need: string | null
}) {
  // The line sets as large as the room beside the ring allows for its length (baseball.css).
  const style = { '--need-ems': textEms(need ?? '') } as CSSProperties
  return (
    <div className="stance-gauge" style={style}>
      <div
        ref={ref}
        className="stance-gauge-ring"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="stance-gauge-track" cx="50" cy="50" r="42" />
          <circle className="stance-gauge-fill" cx="50" cy="50" r="42" pathLength={1} />
        </svg>
      </div>
      <p className="stance-gauge-need" role="status">
        {need}
      </p>
      <p className="stance-gauge-hint">{hint}</p>
    </div>
  )
}
