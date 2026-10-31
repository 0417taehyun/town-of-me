import type { CSSProperties, RefObject } from 'react'
import type { CameraPanelLayout } from './cameraPanelLayout'

/**
 * The camera panel: the mirrored camera with the visitor's pose (drawn by the vision loop, cameraOverlay.ts) and a
 * chip saying what the camera sees. `layout` places it (cameraPanelLayout.ts); the side panel's width is the layout's,
 * so the play's band matches it, and the other sizes are baseball.css's. It is decorative to a screen reader, which
 * hears the camera's state from the setup card or the HUD instead.
 */
export function CameraPanel({
  video,
  canvas,
  layout,
  state,
  seen,
}: {
  video: RefObject<HTMLVideoElement | null>
  canvas: RefObject<HTMLCanvasElement | null>
  layout: CameraPanelLayout
  state: string | null
  seen: boolean
}) {
  const style = { '--camera-panel-width': `${layout.width}px` } as CSSProperties
  return (
    <>
      {/* The feed stays rendered, all but invisible, so its frames keep coming while the panel is hidden. */}
      <video ref={video} className="camera-feed" aria-hidden="true" muted playsInline />
      <div
        className="camera-panel"
        data-placement={layout.placement}
        data-side={layout.side}
        data-seen={seen}
        hidden={layout.placement === 'hidden'}
        style={style}
        aria-hidden="true"
      >
        <canvas ref={canvas} />
        {state && <p className="camera-state">{state}</p>}
      </div>
    </>
  )
}
