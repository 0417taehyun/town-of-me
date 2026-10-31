export function createPhotoFilename(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-')
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('')
  return `town-of-me-${date}-${time}.png`
}

export function saveCanvasPhoto(canvas: HTMLCanvasElement, now = new Date()) {
  return new Promise<boolean>((resolve) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(false)
          return
        }
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = createPhotoFilename(now)
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
        resolve(true)
      }, 'image/png')
    } catch {
      resolve(false)
    }
  })
}
