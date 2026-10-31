import { ShaderChunk } from 'three'
import { describe, expect, it } from 'vitest'
import { installWorldCurve } from './worldCurve'

const curveMarker = 'worldCurveDrop'

describe('world curve', () => {
  it('leaves shaders flat until the town installs it, then bends them once however often it is installed', () => {
    const flatChunk = ShaderChunk.logdepthbuf_vertex
    expect(flatChunk).not.toContain(curveMarker)
    installWorldCurve()
    const curvedChunk = ShaderChunk.logdepthbuf_vertex
    installWorldCurve()
    expect(ShaderChunk.logdepthbuf_vertex).toBe(curvedChunk)
    expect(curvedChunk).toContain(curveMarker)
    expect(curvedChunk.endsWith(flatChunk)).toBe(true)
  })
})
