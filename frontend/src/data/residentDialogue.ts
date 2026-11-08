import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { normalizeLinkedInProfileUrl } from './linkedInProfile'
import type { ResidentDialogue, TownOwner, TownResident } from './models'
import { contactEmailHref } from './townApi'

export type ResidentQuestionId = 'about-owner' | 'about-resident' | `follow-up-${number}`
export type ResidentQuestion = { id: ResidentQuestionId; label: string }
export type DialogueLink = { href: string; label: string }
type Speaker = Pick<TownResident, 'name' | 'role' | 'relationship' | 'linkedInProfileUrl' | 'dialogue'>
type Owner = Pick<TownOwner, 'name' | 'introduction' | 'contactEmail' | 'linkedInProfileUrl' | 'questions'>
type FollowUps = ResidentDialogue['followUps']

const followUpPrefix = 'follow-up-'

/** `owner` is the town owner's name in `language`. */
export function firstResidentQuestions(language: AppLanguage, owner: string): ResidentQuestion[] {
  const copy = languageCopy[language].residentDialogue
  return [
    { id: 'about-owner', label: copy.aboutOwner(owner) },
    { id: 'about-resident', label: copy.aboutResident },
  ]
}

/** The town owner is only asked who they are; they never describe themselves in the third person. */
export function firstOwnerQuestions(language: AppLanguage): ResidentQuestion[] {
  return [{ id: 'about-resident', label: languageCopy[language].residentDialogue.askOwner }]
}

export function followUpQuestions(followUps: FollowUps, language: AppLanguage): ResidentQuestion[] {
  return followUps.map((followUp, index) => ({ id: `${followUpPrefix}${index}`, label: followUp.question[language] }))
}

export function followUpAnswer(followUps: FollowUps, questionId: ResidentQuestionId, language: AppLanguage) {
  return followUps[Number(questionId.slice(followUpPrefix.length))]?.answer[language]
}

/** A fixed template rather than an LLM: who the resident is and how they know the owner, from what the admin wrote. */
export function introduceResident(resident: Speaker, language: AppLanguage, owner: string) {
  const copy = languageCopy[language].residentDialogue
  const role = resident.role[language].trim()
  const relationship = resident.relationship[language].trim()
  return [
    copy.introduction(resident.name),
    role && copy.role(role),
    relationship && copy.relationship(owner, relationship),
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * What a resident says to `questionId` and what the visitor may ask next. Follow-up questions open once the
 * resident has talked about the town owner, named `owner`, and nothing already asked in this conversation is offered
 * again. A resident without prepared dialogue says a neutral line rather than an invented reference. Introducing
 * themselves, they also offer their LinkedIn profile.
 */
export function answerResidentQuestion(
  resident: Speaker,
  questionId: ResidentQuestionId,
  asked: readonly ResidentQuestionId[],
  language: AppLanguage,
  owner: string,
) {
  const nowAsked = [...asked, questionId]
  const followUps = followUpQuestions(resident.dialogue?.followUps ?? [], language)
  const [aboutOwner, aboutResident] = firstResidentQuestions(language, owner)
  const candidates = [...(nowAsked.includes('about-owner') ? followUps : [aboutOwner]), aboutResident]
  // The link opens from the page, so only a real LinkedIn profile address is offered, whatever the editor holds.
  const linkedIn = questionId === 'about-resident' ? normalizeLinkedInProfileUrl(resident.linkedInProfileUrl) : null
  return {
    text: answerText(resident, questionId, language, owner),
    links: linkedIn ? [{ href: linkedIn, label: languageCopy[language].residentDialogue.linkedIn }] : [],
    choices: candidates.filter(({ id }) => !nowAsked.includes(id)),
    asked: nowAsked,
  }
}

export function answerText(resident: Speaker, questionId: ResidentQuestionId, language: AppLanguage, owner: string) {
  const copy = languageCopy[language].residentDialogue
  const dialogue = resident.dialogue
  if (questionId === 'about-resident') {
    return dialogue?.aboutResident?.[language].trim() || introduceResident(resident, language, owner)
  }
  if (questionId === 'about-owner') return dialogue?.aboutOwner[language] ?? copy.noReference(owner)
  return followUpAnswer(dialogue?.followUps ?? [], questionId, language) ?? copy.noReference(owner)
}

/**
 * What the town owner's resident says to `questionId` and what the visitor may ask next: "Who are you?" is answered
 * with the owner's introduction, the same contact link as the HUD's, and their LinkedIn profile, then the owner's own
 * questions follow, each offered once.
 */
export function answerOwnerQuestion(
  owner: Owner,
  questionId: ResidentQuestionId,
  asked: readonly ResidentQuestionId[],
  language: AppLanguage,
) {
  const nowAsked = [...asked, questionId]
  const candidates = [...firstOwnerQuestions(language), ...followUpQuestions(owner.questions, language)]
  return {
    text: ownerAnswerText(owner, questionId, language),
    links: questionId === 'about-resident' ? ownerLinks(owner, language) : [],
    choices: candidates.filter(({ id }) => !nowAsked.includes(id)),
    asked: nowAsked,
  }
}

/** The owner's contact email and LinkedIn profile, each only when set; the profile only when it is a real one. */
export function ownerLinks(owner: Owner, language: AppLanguage): DialogueLink[] {
  const copy = languageCopy[language]
  const linkedIn = normalizeLinkedInProfileUrl(owner.linkedInProfileUrl)
  const links = [
    owner.contactEmail && {
      href: contactEmailHref(owner.contactEmail),
      label: copy.introduction.contact(owner.name[language]),
    },
    linkedIn && { href: linkedIn, label: copy.residentDialogue.linkedIn },
  ]
  return links.filter((link): link is DialogueLink => Boolean(link))
}

/** Without an introduction, the owner welcomes the visitor instead. */
export function ownerAnswerText(owner: Owner, questionId: ResidentQuestionId, language: AppLanguage) {
  const welcome = languageCopy[language].residentDialogue.ownerWelcome
  if (questionId === 'about-resident') return owner.introduction?.[language] ?? welcome
  return followUpAnswer(owner.questions, questionId, language) ?? welcome
}
