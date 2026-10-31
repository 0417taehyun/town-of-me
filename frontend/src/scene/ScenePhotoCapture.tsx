import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { saveCanvasPhoto } from './photoCapture'

export function ScenePhotoCapture({ request, onComplete }: { request: number; onComplete: (saved: boolean) => void }) {
  const { camera, gl, scene } = useThree()
  const handledRequest = useRef(request)

  useEffect(() => {
    if (request === handledRequest.current) return
    handledRequest.current = request
    gl.render(scene, camera)
    void saveCanvasPhoto(gl.domElement).then(onComplete)
  }, [camera, gl, onComplete, request, scene])

  return null
}
