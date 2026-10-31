export interface ChoiceButtonGroupProps<Value extends string> {
  ariaLabel: string
  className?: string
  name: string
  options: readonly Value[]
  value: Value
  onChange: (value: Value) => void
  getOptionLabel?: (value: Value) => string
}

export function ChoiceButtonGroup<Value extends string>({
  ariaLabel,
  className,
  name,
  options,
  value,
  onChange,
  getOptionLabel = String,
}: ChoiceButtonGroupProps<Value>) {
  const classes = ['choice-button-group', className].filter(Boolean).join(' ')

  return (
    <div className={classes} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          name={name}
          value={option}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {getOptionLabel(option)}
        </button>
      ))}
    </div>
  )
}
