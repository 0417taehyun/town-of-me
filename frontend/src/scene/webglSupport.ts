type GraphicsProbe = { getExtension: (name: string) => { loseContext?: () => void } | null }

export const CHROME_GRAPHICS_SETTINGS = 'chrome://settings/system'

const MANUAL_COPY_HINT = 'Select and copy the address below, then paste it into Chrome’s address bar and press Enter.'

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

export async function copyGraphicsSettingsAddress(clipboard?: Pick<Clipboard, 'writeText'>): Promise<string> {
  const copied = await copyText(CHROME_GRAPHICS_SETTINGS, clipboard)
  return copied ? 'Address copied. Paste it into Chrome’s address bar and press Enter.' : MANUAL_COPY_HINT
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
