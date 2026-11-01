import { useState } from 'react'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import { CHROME_GRAPHICS_SETTINGS, copyStatus, copyText } from '../../scene/webglSupport'
import type { DeviceBlock } from '../deviceGate'

/**
 * Why this device cannot play, in the visitor's language, with the address that gets them there: Chrome's graphics
 * settings, or this page's, to open on a computer (a faster one, when this one tracks too slowly). When the clipboard
 * is unavailable or refuses, the address stays selectable to copy by hand. Only the graphics block offers a reload, for
 * after the setting changes; a slow computer gets no other try.
 */
export function DeviceBlocked({ block, language }: { block: DeviceBlock; language: AppLanguage }) {
  const copy = languageCopy[language].baseball.blocked
  const reason = copy[block]
  const [address] = useState(() => (block === 'graphics' ? CHROME_GRAPHICS_SETTINGS : window.location.href))
  const [copied, setCopied] = useState<boolean | null>(null)
  const status = copyStatus(copied, { untried: '', copied: reason.copied, byHand: copy.copyByHand })
  return (
    <section className="baseball-card derby-blocked" role="alert" aria-labelledby="derby-blocked-title">
      <h1 id="derby-blocked-title">{reason.title}</h1>
      <p>{reason.description}</p>
      <button
        className="primary-button compact"
        type="button"
        onClick={() => void copyText(address, navigator.clipboard).then(setCopied)}
      >
        {reason.copy}
      </button>
      <input
        className="graphics-settings-address"
        aria-label={reason.addressLabel}
        value={address}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <small role="status">{status}</small>
      {block === 'graphics' && (
        <button className="text-button" type="button" onClick={() => window.location.reload()}>
          {copy.reload}
        </button>
      )}
    </section>
  )
}
