import { useState } from 'react'
import type { LocalizedText, ResidentDialogue, TownResident, TownSnapshot } from '../data/models'
import { draftResidentDialogue } from '../data/townApi'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { draftFailureMessage } from './editorPanelText'
import { canDraftDialogue, changeResident, EMPTY_LOCALIZED_TEXT } from './townEditing'
import { useGestureEdit } from './useGestureEdit'
import type { TownEditor } from './useTownEditor'

type Copy = (typeof languageCopy)[AppLanguage]['editor']
type Edit = TownEditor['edit']
type Change = (town: TownSnapshot) => TownSnapshot
type FollowUps = ResidentDialogue['followUps']

// Mirrors the limits in backend/src/town.ts.
const sourceTextLimit = 2000
const dialogueLineLimit = 400
const shortLineLimit = 80
const followUpLimit = 3
const ownerQuestionLimit = 5
const textLanguages = ['ko', 'en'] as const

const emptyDialogue: ResidentDialogue = {
  aboutResident: EMPTY_LOCALIZED_TEXT,
  aboutOwner: EMPTY_LOCALIZED_TEXT,
  followUps: [],
}

export function LanguageInput({
  label,
  value,
  maxLength,
  multiline,
  onFocus,
  onChange,
}: {
  label: string
  value: string
  maxLength: number
  multiline: boolean
  onFocus: () => void
  onChange: (value: string) => void
}) {
  if (!multiline) {
    return (
      <input
        type="text"
        aria-label={label}
        value={value}
        maxLength={maxLength}
        onFocus={onFocus}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    )
  }
  return (
    <textarea
      aria-label={label}
      rows={3}
      value={value}
      maxLength={maxLength}
      onFocus={onFocus}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  )
}

export function LocalizedField({
  id,
  label,
  value,
  maxLength,
  multiline = true,
  copy,
  edit,
  onChange,
}: {
  id?: string
  label: string
  value: LocalizedText
  maxLength: number
  multiline?: boolean
  copy: Copy
  edit: Edit
  onChange: (value: LocalizedText) => Change
}) {
  const gesture = useGestureEdit(edit)
  return (
    <div id={id} className="editor-localized">
      <span>{label}</span>
      {textLanguages.map((language) => (
        <label key={language} className="editor-field">
          <small>{copy.textLanguages[language]}</small>
          <LanguageInput
            label={`${label} · ${copy.textLanguages[language]}`}
            value={value[language]}
            maxLength={maxLength}
            multiline={multiline}
            onFocus={gesture.start}
            onChange={(text) => gesture.apply(onChange({ ...value, [language]: text }))}
          />
        </label>
      ))}
    </div>
  )
}

/** Questions visitors can ask, each with its answer, in both languages: a resident's follow-ups or the owner's own. */
export function QuestionFields({
  questions,
  limit,
  labels,
  copy,
  edit,
  onChange,
}: {
  questions: FollowUps
  limit: number
  labels: { question: (number: number) => string; answer: (number: number) => string; add: string; remove: string }
  copy: Copy
  edit: Edit
  onChange: (questions: FollowUps) => Change
}) {
  const changeQuestion = (index: number, changes: Partial<FollowUps[number]>) =>
    onChange(questions.map((followUp, current) => (current === index ? { ...followUp, ...changes } : followUp)))
  return (
    <>
      {questions.map((followUp, index) => (
        <div key={index} className="editor-follow-up">
          <LocalizedField
            label={labels.question(index + 1)}
            value={followUp.question}
            maxLength={shortLineLimit}
            multiline={false}
            copy={copy}
            edit={edit}
            onChange={(question) => changeQuestion(index, { question })}
          />
          <LocalizedField
            label={labels.answer(index + 1)}
            value={followUp.answer}
            maxLength={dialogueLineLimit}
            copy={copy}
            edit={edit}
            onChange={(answer) => changeQuestion(index, { answer })}
          />
          <button
            className="text-button danger"
            type="button"
            onClick={() => edit(onChange(questions.filter((_, current) => current !== index)))}
          >
            {labels.remove}
          </button>
        </div>
      ))}
      {questions.length < limit && (
        <button
          className="text-button"
          type="button"
          onClick={() =>
            edit(onChange([...questions, { question: EMPTY_LOCALIZED_TEXT, answer: EMPTY_LOCALIZED_TEXT }]))
          }
        >
          {labels.add}
        </button>
      )}
    </>
  )
}

export function DialogueFields({
  dialogue,
  ownerName,
  copy,
  edit,
  onChange,
}: {
  dialogue: ResidentDialogue
  ownerName: string
  copy: Copy
  edit: Edit
  onChange: (dialogue: ResidentDialogue) => Change
}) {
  return (
    <>
      <LocalizedField
        label={copy.aboutResidentLine}
        value={dialogue.aboutResident ?? EMPTY_LOCALIZED_TEXT}
        maxLength={dialogueLineLimit}
        copy={copy}
        edit={edit}
        onChange={(aboutResident) => onChange({ ...dialogue, aboutResident })}
      />
      <LocalizedField
        label={copy.aboutOwner(ownerName)}
        value={dialogue.aboutOwner}
        maxLength={dialogueLineLimit}
        copy={copy}
        edit={edit}
        onChange={(aboutOwner) => onChange({ ...dialogue, aboutOwner })}
      />
      <QuestionFields
        questions={dialogue.followUps}
        limit={followUpLimit}
        labels={{
          question: copy.followUpQuestion,
          answer: copy.followUpAnswer,
          add: copy.addFollowUp,
          remove: copy.removeFollowUp,
        }}
        copy={copy}
        edit={edit}
        onChange={(followUps) => onChange({ ...dialogue, followUps })}
      />
    </>
  )
}

/**
 * The town owner's resident answers "Who are you?" with the owner introduction, edited in the town settings, and
 * then the questions the owner writes here; they have no reference, relationship, role, or drafted dialogue.
 */
export function OwnerConversationFields({
  questions,
  copy,
  edit,
  onEditIntroduction,
}: {
  questions: FollowUps
  copy: Copy
  edit: Edit
  onEditIntroduction: () => void
}) {
  return (
    <fieldset className="editor-conversation">
      <legend>{copy.ownerQuestions}</legend>
      <p className="editor-note">{copy.ownerIntroductionNote}</p>
      <div className="editor-actions">
        <button className="text-button" type="button" onClick={onEditIntroduction}>
          {copy.editOwnerIntroduction}
        </button>
      </div>
      <QuestionFields
        questions={questions}
        limit={ownerQuestionLimit}
        labels={{
          question: copy.ownerQuestion,
          answer: copy.ownerAnswer,
          add: copy.addOwnerQuestion,
          remove: copy.removeOwnerQuestion,
        }}
        copy={copy}
        edit={edit}
        onChange={(next) => (town) => ({ ...town, owner: { ...town.owner, questions: next } })}
      />
    </fieldset>
  )
}

/**
 * The resident introduces themselves from their role and relationship with a fixed template, and talks about the
 * town owner, named `owner`, only with the reviewed dialogue drafted from their reference.
 */
export function ResidentConversationFields({
  resident,
  owner,
  language,
  copy,
  edit,
}: {
  resident: TownResident
  owner: LocalizedText
  language: AppLanguage
  copy: Copy
  edit: Edit
}) {
  const ownerName = owner[language]
  const [drafting, setDrafting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const update = (changes: Partial<TownResident>): Change => changeResident(resident.id, changes)

  const draft = async () => {
    if (resident.dialogue && !window.confirm(copy.redraftConfirm)) return
    setDrafting(true)
    setFailure(null)
    try {
      const dialogue = await draftResidentDialogue(resident, owner)
      edit(update({ dialogue }))
    } catch (error) {
      setFailure(draftFailureMessage(error, copy))
    } finally {
      setDrafting(false)
    }
  }

  const draftLabel = resident.dialogue ? copy.redraft : copy.draft
  return (
    <fieldset className="editor-conversation">
      <legend>{copy.conversation}</legend>
      <LocalizedField
        label={copy.role}
        value={resident.role}
        maxLength={shortLineLimit}
        multiline={false}
        copy={copy}
        edit={edit}
        onChange={(role) => update({ role })}
      />
      <LocalizedField
        label={copy.relationship(ownerName)}
        value={resident.relationship}
        maxLength={shortLineLimit}
        multiline={false}
        copy={copy}
        edit={edit}
        onChange={(relationship) => update({ relationship })}
      />
      <p className="editor-note">{copy.introductionHint}</p>
      <LocalizedField
        label={copy.reference(ownerName)}
        value={resident.reference}
        maxLength={sourceTextLimit}
        copy={copy}
        edit={edit}
        onChange={(reference) => update({ reference })}
      />
      <p className="editor-note">{copy.draftHint(ownerName)}</p>
      <div className="editor-actions">
        <button
          className="primary-button editor-primary"
          type="button"
          disabled={drafting || !canDraftDialogue(resident)}
          onClick={() => void draft()}
        >
          {drafting ? copy.drafting : draftLabel}
        </button>
        {!resident.dialogue && (
          <button className="text-button" type="button" onClick={() => edit(update({ dialogue: emptyDialogue }))}>
            {copy.writeByHand}
          </button>
        )}
      </div>
      {failure && (
        <small className="editor-field-error" role="alert">
          {failure}
        </small>
      )}
      {resident.dialogue && (
        <DialogueFields
          dialogue={resident.dialogue}
          ownerName={ownerName}
          copy={copy}
          edit={edit}
          onChange={(dialogue) => update({ dialogue })}
        />
      )}
    </fieldset>
  )
}
