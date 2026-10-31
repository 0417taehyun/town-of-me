import {
  DataTexture,
  MeshDepthMaterial,
  MeshToonMaterial,
  RedFormat,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { ambientWind } from './vegetationMotion'

export const glslFloat = (value: number) => value.toFixed(4)

const swayUniforms = { foliageTime: { value: 0 }, foliageSwayScale: { value: 1 } }

// The phase changes slowly across the town, so a flower's stem, petals, and center lean together while neighboring
// trees lean at different moments.
const swayVertexPars = /* glsl */ `
uniform float foliageTime;
uniform float foliageSwayScale;
vec2 foliageSway( vec2 origin, float height ) {
  float phase = origin.x * ${glslFloat(ambientWind.phaseX)} + origin.y * ${glslFloat(ambientWind.phaseZ)};
  // Grounded parts stay put; taller plants bend less per meter, so flowers nod while crowns only lean.
  float lean = sqrt( max( height, 0.0 ) ) * foliageSwayScale;
  return vec2(
    sin( foliageTime * ${glslFloat(ambientWind.speedX)} + phase ) * 0.05,
    cos( foliageTime * ${glslFloat(ambientWind.speedZ)} + phase ) * 0.037
  ) * lean;
}`

// Sways in town space after the instance transform, so scaled and tilted petals still lean with the wind.
const swayProjectVertex = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  mvPosition.xz += foliageSway( instanceMatrix[ 3 ].xz, mvPosition.y );
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`

// The rim takes the sky's share of the light, so silhouettes glow softly by day and darken with the night.
const rimFragment = /* glsl */ `
float foliageRim = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 2.5 );
outgoingLight += reflectedLight.indirectDiffuse * foliageRim * 0.6;
#include <opaque_fragment>`

export function addSway(shader: WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, swayUniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${swayVertexPars}`)
    .replace('#include <project_vertex>', swayProjectVertex)
}

/** Four soft light bands from the shaded back of a crown to its sunlit face. */
export function createGradientMap() {
  const gradient = new DataTexture(Uint8Array.from([97, 158, 214, 255]), 4, 1, RedFormat)
  gradient.needsUpdate = true
  return gradient
}

/** Shared by tree crowns and flowers; per-instance colors tint it. */
export const foliageMaterial = new MeshToonMaterial({ gradientMap: createGradientMap() })
foliageMaterial.onBeforeCompile = (shader) => {
  addSway(shader)
  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', rimFragment)
}

/** Lets the foliage's shadows sway with it. */
export const foliageDepthMaterial = new MeshDepthMaterial()
foliageDepthMaterial.onBeforeCompile = addSway

export function updateFoliageSway(elapsed: number, reducedMotion: boolean) {
  swayUniforms.foliageTime.value = elapsed
  swayUniforms.foliageSwayScale.value = reducedMotion ? 0.35 : 1
}
