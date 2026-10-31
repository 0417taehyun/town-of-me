import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, type CanvasProps } from '@react-three/fiber'
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CHROME_GRAPHICS_SETTINGS, copyGraphicsSettingsAddress, supportsWebGL } from './webglSupport'

/** The sharpest pixel ratio a scene renders at; devices that cannot hold the frame rate drop to 1. */
const SHARP_PIXEL_RATIO = 1.35

export function GraphicsFallback({ preview = false }: { preview?: boolean }) {
  const [settingsStatus, setSettingsStatus] = useState('')
  return (
    <div className={`webgl-fallback ${preview ? 'preview-fallback' : ''}`} role="alert">
      <strong>{preview ? '3D preview unavailable' : 'The 3D town could not open.'}</strong>
      <p>In Chrome settings, turn on “Use graphics acceleration when available”, then relaunch Chrome.</p>
      <button
        className="primary-button compact"
        type="button"
        onClick={() => void copyGraphicsSettingsAddress(navigator.clipboard).then(setSettingsStatus)}
      >
        Copy Chrome settings address
      </button>
      <input
        className="graphics-settings-address"
        aria-label="Chrome graphics settings address"
        value={CHROME_GRAPHICS_SETTINGS}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <small role="status">
        {settingsStatus || 'Paste this address into Chrome. Websites cannot open browser settings directly.'}
      </small>
      <button className="text-button" type="button" onClick={() => window.location.reload()}>
        Reload page
      </button>
    </div>
  )
}

class GraphicsBoundary extends Component<
  { children: ReactNode; preview: boolean; onFailed: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFailed()
  }
  render() {
    if (this.state.failed) return <GraphicsFallback preview={this.props.preview} />
    return this.props.children
  }
}

/**
 * A 3D canvas that shows the graphics fallback when WebGL 2 is missing, lost, or fails while drawing, and then calls
 * `onUnavailable`. Without a fixed `dpr`, it renders up to SHARP_PIXEL_RATIO and drops to 1 while the device cannot
 * hold the frame rate.
 */
export function GraphicsCanvas({
  preview = false,
  onCreated,
  onUnavailable,
  dpr,
  children,
  ...props
}: CanvasProps & { preview?: boolean; onUnavailable?: () => void }) {
  const [supported, setSupported] = useState(() =>
    supportsWebGL(() => document.createElement('canvas').getContext('webgl2')),
  )
  const [sharpest, setSharpest] = useState(SHARP_PIXEL_RATIO)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const contextLost = useCallback((event: Event) => {
    event.preventDefault()
    setSupported(false)
  }, [])
  useEffect(() => () => canvas.current?.removeEventListener('webglcontextlost', contextLost), [contextLost])
  useEffect(() => {
    if (supported) return
    onUnavailable?.()
  }, [onUnavailable, supported])
  if (!supported) return <GraphicsFallback preview={preview} />
  return (
    <GraphicsBoundary preview={preview} onFailed={() => setSupported(false)}>
      <Canvas
        {...props}
        dpr={dpr ?? [1, sharpest]}
        fallback={<GraphicsFallback preview={preview} />}
        onCreated={(state) => {
          canvas.current = state.gl.domElement
          canvas.current.addEventListener('webglcontextlost', contextLost)
          onCreated?.(state)
        }}
      >
        {!dpr && (
          <PerformanceMonitor
            flipflops={3}
            onDecline={() => setSharpest(1)}
            onIncline={() => setSharpest(SHARP_PIXEL_RATIO)}
            onFallback={() => setSharpest(1)}
          />
        )}
        {children}
      </Canvas>
    </GraphicsBoundary>
  )
}
