import { useSyncExternalStore } from 'react'

export function subscribeToResize(onResize: () => void) {
  window.addEventListener('resize', onResize)
  return () => window.removeEventListener('resize', onResize)
}

export function viewportWidth() {
  return window.innerWidth
}

export function viewportHeight() {
  return window.innerHeight
}

/** The window's size in CSS px, kept current as it resizes. */
export function useViewportSize() {
  const width = useSyncExternalStore(subscribeToResize, viewportWidth)
  const height = useSyncExternalStore(subscribeToResize, viewportHeight)
  return { width, height }
}
