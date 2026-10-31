import { ShaderChunk } from 'three'
import { clamp01, smoothstep } from '../motionMath'

/**
 * Animal Crossing's rolling-log world: everything drawn sinks by this many meters per square meter of horizontal
 * distance from the camera, so the town bends away over a near horizon.
 */
const WORLD_CURVE_STRENGTH = 0.0008
/** The editor's top view looks down from above this height, where a flat map is easier to arrange. */
const FLAT_ABOVE_HEIGHT = 15

// The curve runs in the log-depth chunk because every built-in vertex shader includes it right after project_vertex,
// which materials such as the swaying foliage replace with their own. It moves the clip position by the projected
// drop instead of reprojecting, so shaders that build their own (drei's Line) keep it. The back-sided sky dome stays
// put, and orthographic shadow cameras render flat to match the receivers' uncurved shadow coordinates.
const curveVertex = /* glsl */ `
#ifndef FLIP_SIDED
{
  float worldCurve = ${WORLD_CURVE_STRENGTH.toFixed(5)} * float( isPerspectiveMatrix( projectionMatrix ) )
    * ( 1.0 - smoothstep( ${(FLAT_ABOVE_HEIGHT - 2).toFixed(1)}, ${FLAT_ABOVE_HEIGHT.toFixed(1)}, cameraPosition.y ) );
  vec3 worldUpInView = viewMatrix[ 1 ].xyz;
  float heightFromCamera = dot( mvPosition.xyz, worldUpInView );
  float horizontalDistanceSquared = dot( mvPosition.xyz, mvPosition.xyz ) - heightFromCamera * heightFromCamera;
  vec4 worldCurveDrop = vec4( worldUpInView * ( - worldCurve * horizontalDistanceSquared ), 0.0 );
  mvPosition += worldCurveDrop;
  gl_Position += projectionMatrix * worldCurveDrop;
}
#endif
`

ShaderChunk.logdepthbuf_vertex = curveVertex + ShaderChunk.logdepthbuf_vertex

/** How far the curve above lowers a point at this squared horizontal distance from a perspective camera. */
export function getWorldCurveDrop(horizontalDistanceSquared: number, cameraHeight: number) {
  const flat = smoothstep(clamp01((cameraHeight - (FLAT_ABOVE_HEIGHT - 2)) / 2))
  return WORLD_CURVE_STRENGTH * (1 - flat) * horizontalDistanceSquared
}
