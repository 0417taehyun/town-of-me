import type { DialogueMessage, Interaction } from '../scene/playerInteraction'
import type { ResidentQuestionId } from '../data/residentDialogue'
import { dialogueLinkEvent, recordSiteEvent } from '../data/siteEvents'

export function Toast({ message }: { message: string | null }) {
  return message ? (
    <div className="toast" role="status">
      <span aria-hidden="true">✓</span>
      {message}
    </div>
  ) : null
}

export function InteractionPrompt({
  interaction,
  greetLabel,
  onInteract,
  onGreet,
}: {
  interaction: Interaction | null
  /** Greeting the town's pet, in the visitor's language. */
  greetLabel: string
  onInteract: () => void
  onGreet: () => void
}) {
  // A statue's card opens on its own as the visitor comes near (StatueCard.tsx); there is nothing to press.
  if (!interaction || interaction.kind === 'statue') return null
  return (
    <div className="interaction-prompt">
      <button type="button" onClick={onInteract} aria-label={interaction.label}>
        <kbd>E</kbd>
        <span>{interaction.label}</span>
      </button>
      {interaction.actorId === 'pet' && (
        <button type="button" onClick={onGreet} aria-label={greetLabel}>
          <kbd>G</kbd>
          <span>{greetLabel}</span>
        </button>
      )}
    </div>
  )
}

export function TypedLine({ text, revealTimes }: { text: string; revealTimes: readonly number[] }) {
  return Array.from(text).map((character, index) => (
    <span key={index} style={{ animationDelay: `${revealTimes[index]}s` }}>
      {character}
    </span>
  ))
}

type DialogueBoxProps = {
  message: DialogueMessage
  /** When each letter of the line appears while it is being typed; without it the line shows whole. */
  revealTimes?: readonly number[] | null
  closeLabel: string
  onChoice: (choice: ResidentQuestionId) => void
  onClose: () => void
}

export function Dialogue({
  message,
  ...boxProps
}: Omit<DialogueBoxProps, 'message'> & { message: DialogueMessage | null }) {
  return (
    <>
      {/* The live region stays mounted between lines so the first line of a conversation is announced too. */}
      <p className="dialogue-announcement" aria-live="polite" aria-atomic="true">
        {message && `${message.speaker}: ${message.text}`}
      </p>
      {message && <DialogueBox message={message} {...boxProps} />}
    </>
  )
}

export function DialogueBox({ message, revealTimes, closeLabel, onChoice, onClose }: DialogueBoxProps) {
  const links = message.links ?? []
  return (
    <section className="dialogue" role="dialog" aria-label={message.speaker}>
      <div className="dialogue-avatar" aria-hidden="true">
        {message.avatar}
      </div>
      <div className="dialogue-copy">
        <strong>{message.speaker}</strong>
        {/* A new line remounts its letters so their fade-in restarts. */}
        <p key={message.text} className={revealTimes ? 'is-typing' : undefined} aria-hidden="true">
          {revealTimes ? <TypedLine text={message.text} revealTimes={revealTimes} /> : message.text}
        </p>
        {links.length > 0 && (
          <div className="dialogue-links">
            {links.map((link) => (
              <a
                key={link.href}
                className="dialogue-link"
                href={link.href}
                // A mail link opens the visitor's mail app, which would leave a blank tab behind.
                target={link.href.startsWith('mailto:') ? undefined : '_blank'}
                rel="noopener noreferrer"
                onClick={() => recordSiteEvent(dialogueLinkEvent(link.href))}
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
        {message.choices && (
          <div className="dialogue-choices">
            {message.choices.map((choice, index) => (
              <button key={choice.id} type="button" onClick={() => onChoice(choice.id)}>
                <span aria-hidden="true">{index + 1}</span>
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="dialogue-close" type="button" onClick={onClose} aria-label={closeLabel}>
        ×
      </button>
    </section>
  )
}
