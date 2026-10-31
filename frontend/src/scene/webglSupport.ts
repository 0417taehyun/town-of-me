type GraphicsProbe = { getExtension: (name: string) => { loseContext?: () => void } | null }

export const CHROME_GRAPHICS_SETTINGS = 'chrome://settings/system'

const MANUAL_COPY_HINT = 'Select and copy the address below, then paste it into Chrome’s address bar and press Enter.'

export async function copyGraphicsSettingsAddress(clipboard?: Pick<Clipboard, 'writeText'>): Promise<string> {
  if (!clipboard) return MANUAL_COPY_HINT
  try {
    await clipboard.writeText(CHROME_GRAPHICS_SETTINGS)
    return 'Address copied. Paste it into Chrome’s address bar and press Enter.'
  } catch {
    return MANUAL_COPY_HINT
  }
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
