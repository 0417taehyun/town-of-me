import { describe, expect, it } from 'vitest'
import type { ResidentDialogue } from './models'
import {
  answerOwnerQuestion,
  answerResidentQuestion,
  firstOwnerQuestions,
  firstResidentQuestions,
} from './residentDialogue'

const dialogue: ResidentDialogue = {
  aboutOwner: { ko: '로빈은 먼저 만들어 봐요.', en: 'Robin builds first.' },
  followUps: [
    {
      question: { ko: '같이 지내기는 어때요?', en: 'What is Robin like as a neighbor?' },
      answer: { ko: '같이 고민해 줘요.', en: 'Robin thinks it through with you.' },
    },
    {
      question: { ko: '빵 맛은요?', en: 'And the bread?' },
      answer: { ko: '모든 빵을 맛봐 줬어요.', en: 'Robin tasted every loaf.' },
    },
  ],
}
const juno = {
  name: 'Juno',
  role: { ko: '마을 정원사', en: 'Town gardener' },
  relationship: { ko: '이웃', en: 'Neighbor' },
  linkedInProfileUrl: 'https://www.linkedin.com/in/juno-example',
  dialogue,
}
const ids = (choices: Array<{ id: string }>) => choices.map(({ id }) => id)

describe('resident dialogue', () => {
  it('opens follow-up questions after the resident talks about the owner', () => {
    const reply = answerResidentQuestion(juno, 'about-owner', [], 'en', 'Robin')
    expect(reply.text).toBe('Robin builds first.')
    expect(reply.choices).toEqual([
      { id: 'follow-up-0', label: 'What is Robin like as a neighbor?' },
      { id: 'follow-up-1', label: 'And the bread?' },
      { id: 'about-resident', label: 'Who are you?' },
    ])
  })

  it('answers follow-ups from the prepared lines and never offers a question twice', () => {
    const first = answerResidentQuestion(juno, 'about-owner', [], 'ko', '로빈')
    const second = answerResidentQuestion(juno, 'follow-up-1', first.asked, 'ko', '로빈')
    expect(second.text).toBe('모든 빵을 맛봐 줬어요.')
    expect(ids(second.choices)).toEqual(['follow-up-0', 'about-resident'])
    const third = answerResidentQuestion(juno, 'about-resident', second.asked, 'ko', '로빈')
    expect(third.text).toBe('안녕하세요, 저는 Juno입니다.\n역할: 마을 정원사\n로빈과의 관계: 이웃')
    expect(third.link).toEqual({ href: 'https://www.linkedin.com/in/juno-example', label: '제 LinkedIn 프로필 보기' })
    expect(ids(third.choices)).toEqual(['follow-up-0'])
    expect(answerResidentQuestion(juno, 'follow-up-0', third.asked, 'ko', '로빈').link).toBeUndefined()
  })

  it('still offers the owner question first when the visitor starts with the resident', () => {
    const reply = answerResidentQuestion(juno, 'about-resident', [], 'en', 'Robin')
    expect(ids(reply.choices)).toEqual(['about-owner'])
    expect(firstResidentQuestions('ko', '토토')).toEqual([
      { id: 'about-owner', label: '토토는 어떤 사람이에요?' },
      { id: 'about-resident', label: '당신은 누구예요?' },
    ])
  })

  it('says neutral lines instead of invented ones before the admin writes them', () => {
    const blank = { ko: '', en: '' }
    const newcomer = { name: 'Pip', role: blank, relationship: blank, dialogue: null }
    expect(answerResidentQuestion(newcomer, 'about-owner', [], 'en', 'Robin').text).toContain('about Robin')
    expect(answerResidentQuestion(newcomer, 'about-owner', [], 'en', 'Robin').choices).toHaveLength(1)
    const introduction = answerResidentQuestion(newcomer, 'about-resident', [], 'en', 'Robin')
    expect(introduction.text).toBe("Hi, I'm Pip.")
    expect(introduction.link).toBeUndefined()
  })

  it('never links to anything but a LinkedIn profile', () => {
    const unsafe = { ...juno, linkedInProfileUrl: 'javascript:alert(1)' }
    expect(answerResidentQuestion(unsafe, 'about-resident', [], 'en', 'Robin').link).toBeUndefined()
  })

  it('lets the owner introduce themselves, then offers only their own questions, each once', () => {
    const robin = {
      name: { ko: '로빈', en: 'Robin' },
      introduction: { ko: '안녕하세요, 로빈이에요.', en: "Hi, I'm Robin." },
      contactEmail: 'robin+town@example.com',
      questions: dialogue.followUps,
    }
    expect(ids(firstOwnerQuestions('en'))).toEqual(['about-resident'])
    const introduction = answerOwnerQuestion(robin, 'about-resident', [], 'en')
    expect(introduction.text).toBe("Hi, I'm Robin.")
    expect(introduction.link?.href).toBe('mailto:robin%2Btown%40example.com')
    expect(ids(introduction.choices)).toEqual(['follow-up-0', 'follow-up-1'])
    const second = answerOwnerQuestion(robin, 'follow-up-1', introduction.asked, 'ko')
    expect(second.text).toBe('모든 빵을 맛봐 줬어요.')
    expect(second.link).toBeUndefined()
    expect(ids(second.choices)).toEqual(['follow-up-0'])
    expect(answerOwnerQuestion(robin, 'follow-up-0', second.asked, 'ko').choices).toEqual([])
  })
})
