import type { CSSProperties, PointerEvent, RefObject } from 'react'
import type { Point } from '../vision/poseLandmarks'
import { tappedImagePoint } from './cameraOverlay'
import type { CameraPanelLayout } from './cameraPanelLayout'

/**
 * The camera panel: the mirrored camera with the visitor's pose and the object found by their hands or locked (drawn
 * by the vision loop, cameraOverlay.ts) and a chip saying what the camera and the swing tracker see. `layout` places
 * it (cameraPanelLayout.ts); the side panel's width is the layout's, so the play's band matches it, and the other
 * sizes are baseball.css's. The object locks by itself; tapping the picture is only a quiet correction that locks the
 * object tapped (`onTap`, with the point in the raw image). It is decorative to a screen reader, which hears the
 * camera's state from the setup card or the HUD instead.
 */
export function CameraPanel({
  video,
  canvas,
  layout,
  state,
  seen,
  onTap,
}: {
  video: RefObject<HTMLVideoElement | null>
  canvas: RefObject<HTMLCanvasElement | null>
  layout: CameraPanelLayout
  state: string | null
  seen: boolean
  onTap: (point: Point) => void
}) {
  const style = { '--camera-panel-width': `${layout.width}px` } as CSSProperties
  const tap = (event: PointerEvent<HTMLCanvasElement>) => {
    const picture = event.currentTarget
    const point = tappedImagePoint({ x: event.clientX, y: event.clientY }, picture.getBoundingClientRect(), picture)
    if (point) onTap(point)
  }
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
        <canvas ref={canvas} onPointerDown={tap} />
        {state && <p className="camera-state">{state}</p>}
      </div>
    </>
  )
}
