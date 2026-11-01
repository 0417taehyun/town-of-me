type GraphicsProbe = { getExtension: (name: string) => { loseContext?: () => void } | null }

export const CHROME_GRAPHICS_SETTINGS = 'chrome://settings/system'

/**
 * Whether `text` reached the clipboard. There is none on an insecure page, and the browser may refuse; either way the
 * caller shows the text for the visitor to select and copy by hand.
 */
export async function copyText(text: string, clipboard?: Pick<Clipboard, 'writeText'>) {
  if (!clipboard) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** What to tell the visitor about `copyText`: `untried` until they press copy, then whether to paste or copy by hand. */
export function copyStatus(copied: boolean | null, messages: { untried: string; copied: string; byHand: string }) {
  if (copied === null) return messages.untried
  return copied ? messages.copied : messages.byHand
}

export function supportsWebGL(createContext: () => GraphicsProbe | null) {
  try {
    const context = createContext()
    context?.getExtension('WEBGL_lose_context')?.loseContext?.()
    return Boolean(context)
  } catch {
    return false
  }
}
