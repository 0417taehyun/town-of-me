import { useCallback, useEffect, useMemo, useState } from 'react'
import { getRevealTimes } from '../audio/dialogueVoice'
import type { DialogueMessage } from '../scene/playerInteraction'

/** Matches the letter fade in styles.css, so the line counts as typed once its last letter is fully shown. */
const LETTER_FADE_SECONDS = 0.09

/** Types a voiced resident line out letter by letter with its blips; `revealTimes` is null once the line is whole. */
export function useDialogueReveal(message: DialogueMessage | null, reducedMotion: boolean) {
  const [finishedMessage, setFinishedMessage] = useState<DialogueMessage | null>(null)
  const typedMessage = message?.voice === 'resident' && !reducedMotion && message !== finishedMessage ? message : null
  const revealTimes = useMemo(() => (typedMessage ? getRevealTimes(typedMessage.text) : null), [typedMessage])

  useEffect(() => {
    if (!typedMessage || !revealTimes) return
    const typedSeconds = (revealTimes.at(-1) ?? 0) + LETTER_FADE_SECONDS
    const timer = window.setTimeout(() => setFinishedMessage(typedMessage), typedSeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [revealTimes, typedMessage])

  const finish = useCallback(() => setFinishedMessage(message), [message])
  return { revealTimes, finish }
}
