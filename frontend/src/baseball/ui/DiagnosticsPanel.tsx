import { type CSSProperties, useEffect, useRef, useState } from 'react'
import {
  DIAGNOSTICS,
  DIAGNOSTICS_WINDOWS,
  diagnosticsAction,
  diagnosticsText,
  saveDiagnosticsLog,
} from '../devDiagnostics'
import { PANEL_EDGE, type PanelSide } from './cameraPanelLayout'

/** Styled here rather than in baseball.css, so a production build carries none of the panel. */
const PANEL_STYLE: CSSProperties = {
  position: 'absolute',
  bottom: 'calc(2vh + 56px)',
  maxWidth: 420,
  maxHeight: '62vh',
  margin: 0,
  padding: '8px 10px',
  overflow: 'hidden',
  borderRadius: 8,
  color: '#f4f1e8',
  background: 'rgba(20, 27, 24, 0.84)',
  font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'pre-wrap',
  pointerEvents: 'none',
}

/**
 * Dev builds only (BaseballApp.tsx): D shows or hides the camera game's diagnostics (devDiagnostics.ts) low on the
 * camera panel's `side`, clear of the pitch, redrawn a few times a second straight on its element while shown; L saves
 * their last minute as a JSON file on this device, shown or not.
 */
export function DiagnosticsPanel({ side }: { side: PanelSide }) {
  const [shown, setShown] = useState(false)
  const text = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = diagnosticsAction(event)
      if (action === 'toggle') setShown((wasShown) => !wasShown)
      if (action === 'save') saveDiagnosticsLog()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!shown) return
    const draw = () => {
      if (text.current) text.current.textContent = diagnosticsText(DIAGNOSTICS, performance.now())
    }
    draw()
    const timer = window.setInterval(draw, DIAGNOSTICS_WINDOWS.redrawMs)
    return () => window.clearInterval(timer)
  }, [shown])

  if (!shown) return null
  return <pre ref={text} style={{ ...PANEL_STYLE, [side]: PANEL_EDGE }} />
}
