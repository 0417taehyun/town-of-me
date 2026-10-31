import { useEffect, useImperativeHandle, useMemo, type Ref } from 'react'
import { type BallParts, createBallParts, disposeBallParts } from './ballMeshes'

/** The ball, its trail, its ground shadow, and its landing ring; the derby director moves them every frame. */
export function Ball({ ref }: { ref: Ref<BallParts> }) {
  const parts = useMemo(() => createBallParts(), [])
  useImperativeHandle(ref, () => parts, [parts])
  useEffect(() => () => disposeBallParts(parts), [parts])
  return <primitive object={parts.group} />
}
