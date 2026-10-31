export function CloseButton({
  onClick,
  label,
  disabled,
  autoFocus,
}: {
  onClick: () => void
  label: string
  disabled?: boolean
  autoFocus?: boolean
}) {
  return (
    <button
      autoFocus={autoFocus}
      className="icon-button close-button"
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
    >
      <span aria-hidden="true">×</span>
    </button>
  )
}
