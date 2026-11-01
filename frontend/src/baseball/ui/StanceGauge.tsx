import type { Ref } from 'react'

/**
 * The ring that fills while the visitor holds the batting stance, with what holding it starts beside it. The vision
 * loop fills it straight on the element (`--stance-progress`, 0..1, and `aria-valuenow`) whenever the hold changes, so
 * React never renders for it (BaseballApp.tsx). Holding is one way on; the step's button beside it is the other.
 */
export function StanceGauge({ ref, label, hint }: { ref: Ref<HTMLDivElement>; label: string; hint: string }) {
  return (
    <div className="stance-gauge">
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
      <p>
        <strong>{label}</strong>
        <span>{hint}</span>
      </p>
    </div>
  )
}
