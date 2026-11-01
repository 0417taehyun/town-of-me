import type { CSSProperties, PointerEvent, RefObject } from 'react'
import type { Point } from '../vision/poseLandmarks'
import { tappedImagePoint } from './cameraOverlay'
import type { CameraPanelLayout } from './cameraPanelLayout'
import { type CameraPanelWords, textEms } from './derbyCues'

/**
 * The camera panel: the mirrored camera with the visitor's pose and the object found by their hands or locked (drawn
 * by the vision loop, cameraOverlay.ts), read from where the visitor bats. Above the picture, never on it, a chip says
 * where the camera and the swing tracker are in a word, coloured by it, and under it a line says what to do
 * (`words`, derbyCues.ts cameraPanelWords). `layout` places it (cameraPanelLayout.ts); the side panel's width is the
 * layout's, so the play's band matches it, and the other sizes are baseball.css's. The object locks by itself; tapping
 * the picture is only a quiet correction that locks the object tapped (`onTap`, with the point in the raw image). It
 * is decorative to a screen reader, which hears the camera's state from the setup card or the HUD instead.
 */
export function CameraPanel({
  video,
  canvas,
  layout,
  words,
  onTap,
}: {
  video: RefObject<HTMLVideoElement | null>
  canvas: RefObject<HTMLCanvasElement | null>
  layout: CameraPanelLayout
  words: CameraPanelWords | null
  onTap: (point: Point) => void
}) {
  const style = { '--camera-panel-width': `${layout.width}px` } as CSSProperties
  // The chip sets its word as large as the panel's width allows, up to its height (baseball.css).
  const chipStyle = { '--chip-ems': textEms(words?.chip ?? '') } as CSSProperties
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
        hidden={layout.placement === 'hidden'}
        style={style}
        aria-hidden="true"
      >
        <p className="camera-state" data-tone={words?.tone} style={chipStyle}>
          {words?.chip}
        </p>
        <div className="camera-picture">
          <canvas ref={canvas} onPointerDown={tap} />
        </div>
        <p className="camera-headline">{words?.headline}</p>
      </div>
    </>
  )
}
