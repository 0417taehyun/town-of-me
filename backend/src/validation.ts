import { DomainError } from './domain.js'

const hexColorPattern = /^#[0-9a-f]{6}$/iu

export function invalidInput(message: string): DomainError {
  return new DomainError('INVALID_INPUT', message)
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function inputRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw invalidInput(`${field} must be an object`)
  return value
}

export function inputList(value: unknown, field: string, maximumCount: number, minimumCount = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimumCount || value.length > maximumCount) {
    throw invalidInput(`${field} must be a list of ${minimumCount} to ${maximumCount} items`)
  }
  return value
}

/** Reads exactly `fields` from `input`, so every other property is dropped. */
export function parseFields<Field extends string>(
  input: Record<string, unknown>,
  fields: readonly Field[],
  parse: (value: unknown, field: Field) => string,
): Record<Field, string> {
  return Object.fromEntries(fields.map((field) => [field, parse(input[field], field)])) as Record<Field, string>
}

/** `undefined` and `null` both mean the field is not set. */
export function optionalInput<Value>(value: unknown, parse: (value: unknown) => Value): Value | null {
  return value === undefined || value === null ? null : parse(value)
}

export function oneOf<Option extends string>(value: unknown, options: readonly Option[], field: string): Option {
  if (!(options as readonly unknown[]).includes(value)) {
    throw invalidInput(`${field} must be one of ${options.join(', ')}`)
  }
  return value as Option
}

/** Text that must match `pattern` as given, such as an id or a style name; `shape` describes it in the error. */
export function matchingText(value: unknown, pattern: RegExp, field: string, shape: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalidInput(`${field} must be ${shape}`)
  return value
}

export function boundedNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidInput(`${field} must be a number from ${minimum} to ${maximum}`)
  }
  return value
}

/** A `#rrggbb` color, kept in lowercase. */
export function hexColor(value: unknown, field: string): string {
  if (typeof value !== 'string' || !hexColorPattern.test(value)) throw invalidInput(`${field} must be a #rrggbb color`)
  return value.toLowerCase()
}

/** One-line user text: no control characters, collapsed whitespace, bounded by code points. */
export function singleLineText(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) {
    throw invalidInput(`${field} must be text without control characters`)
  }
  return boundedText(value.trim().replace(/\s+/gu, ' '), field, maximumLength)
}

/** Textarea text: keeps line breaks, rejects other control characters, bounded by code points. */
export function multilineText(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== 'string') throw invalidInput(`${field} must be text`)
  const text = value.replace(/\r\n?/gu, '\n').trim()
  if (/[^\P{Cc}\n]/u.test(text)) throw invalidInput(`${field} must not contain control characters`)
  return boundedText(text, field, maximumLength)
}

export function boundedText(text: string, field: string, maximumLength: number): string {
  const length = Array.from(text).length
  if (length < 1 || length > maximumLength) {
    throw invalidInput(`${field} must be 1 to ${maximumLength} characters`)
  }
  return text
}
