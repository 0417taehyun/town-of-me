import { useEffect, useState } from 'react'

/**
 * Whether `font` (a CSS font shorthand) has loaded every glyph in `glyphs`, or failed to and left the fallback, so a
 * canvas drawing them can draw again. The font's subsets load by unicode-range, and `document.fonts.ready` does not
 * wait for glyphs only a canvas uses. New glyphs make it false again until they are in.
 */
export function useWebFontGlyphs(font: string, glyphs: string) {
  const request = `${font}\n${glyphs}`
  const [settled, setSettled] = useState<string>()
  useEffect(() => {
    let active = true
    const settle = () => active && setSettled(request)
    void document.fonts?.load(font, glyphs).then(settle, settle)
    return () => {
      active = false
    }
  }, [font, glyphs, request])
  return settled === request
}
