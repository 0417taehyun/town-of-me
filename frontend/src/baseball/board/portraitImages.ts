import { useEffect, useState } from 'react'
import {
  DirectionalLight,
  HemisphereLight,
  type Material,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { profileAppearance, type PlayerProfile } from '../../data/playerProfile'
import { defaultBatterPaint, lookProfile, type StatueLook } from '../../scene/statues/paintedStatue'
import { createStatueFigure } from '../../scene/statues/statueFigure'

// The list's small portraits: each record's character, head and shoulders, in its own colors. One offscreen renderer
// draws each look once into a `blob:` image (the strict CSP's img-src allows blob:), so fifty rows never make fifty
// WebGL contexts, and a look the page saw before is not drawn again.

const portraitPixels = 120

export type PortraitStage = { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera }

let stage: PortraitStage | null = null
let drawing: Promise<unknown> = Promise.resolve()
const portraits = new Map<string, Promise<string | null>>()

export function createPortraitStage(): PortraitStage {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(portraitPixels, portraitPixels, false)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = NeutralToneMapping
  const scene = new Scene()
  const sun = new DirectionalLight('#fff1d6', 2.2)
  sun.position.set(1.6, 3.2, 4)
  scene.add(new HemisphereLight('#fff8ea', '#b9ad92', 1.7), sun)
  const camera = new PerspectiveCamera(30, 1, 0.1, 20)
  camera.position.set(0.55, 1.85, 3.5)
  camera.lookAt(0, 1.58, 0)
  return { renderer, scene, camera }
}

export function mattePaint(color: string): Material {
  return new MeshStandardMaterial({ color, roughness: 0.62 })
}

/** Draws one look and hands back its image's address, or `null` when this browser cannot draw it. */
export async function drawPortrait(look: Exclude<StatueLook, null>) {
  stage ??= createPortraitStage()
  const { renderer, scene, camera } = stage
  const figure = createStatueFigure(
    lookProfile(look),
    look === 'defaultBatter' ? defaultBatterPaint(mattePaint) : mattePaint,
  )
  figure.root.rotation.y = -0.25
  scene.add(figure.root)
  renderer.render(scene, camera)
  scene.remove(figure.root)
  figure.materials.forEach((material) => material.dispose())
  const blob = await new Promise<Blob | null>((resolve) => renderer.domElement.toBlob(resolve))
  return blob && URL.createObjectURL(blob)
}

export function portraitKey(look: Exclude<StatueLook, null>) {
  return look === 'defaultBatter' ? look : JSON.stringify(profileAppearance(look))
}

/** A look's portrait, drawn one at a time in the order asked, so the top rows come first. */
export function portraitImage(look: Exclude<StatueLook, null>): Promise<string | null> {
  const key = portraitKey(look)
  const known = portraits.get(key)
  if (known) return known
  const drawn = drawing.then(() => drawPortrait(look)).catch(() => null)
  drawing = drawn
  portraits.set(key, drawn)
  return drawn
}

/** The portrait of a record's look (`null` is the default batter), once it is drawn. */
export function usePortrait(profile: PlayerProfile | null) {
  const look = profile ?? 'defaultBatter'
  const key = portraitKey(look)
  const [image, setImage] = useState<{ key: string; source: string | null } | null>(null)
  useEffect(() => {
    let active = true
    void portraitImage(look).then((source) => active && setImage({ key, source }))
    return () => {
      active = false
    }
    // The key stands for the look, which a new board hands over as a new but equal object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return image?.key === key ? image.source : null
}
