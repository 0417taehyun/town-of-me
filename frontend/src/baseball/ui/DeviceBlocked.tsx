import { useState } from 'react'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import { CHROME_GRAPHICS_SETTINGS, copyText } from '../../scene/webglSupport'
import type { DeviceBlock } from '../deviceGate'

/**
 * Why this device cannot play, in the visitor's language (the town's `GraphicsFallback` is English only), with the
 * address that gets them there: this page's, to open on a computer, or Chrome's graphics settings. When the clipboard
 * is unavailable or refuses, the address stays selectable to copy by hand.
 */
export function DeviceBlocked({ block, language }: { block: DeviceBlock; language: AppLanguage }) {
  const copy = languageCopy[language].baseball.blocked
  const reason = copy[block]
  const [address] = useState(() => (block === 'mobile' ? window.location.href : CHROME_GRAPHICS_SETTINGS))
  const [copied, setCopied] = useState<boolean | null>(null)
  const status = copied === null ? '' : copied ? reason.copied : copy.copyByHand
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
