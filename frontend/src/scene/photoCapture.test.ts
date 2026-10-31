import { describe, expect, it } from 'vitest'
import { createPhotoFilename } from './photoCapture'

describe('scene photo capture', () => {
  it('creates a filesystem-safe timestamped PNG name', () => {
    expect(createPhotoFilename(new Date(2026, 9, 4, 8, 5, 9))).toBe('town-of-me-2026-10-04-080509.png')
  })
})
