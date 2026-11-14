// The derby plays dialog's words. Only the lazy dialog imports this, so they stay out of `language.ts`, which every
// page loads: they name the checks a run is marked by, and no visitor's browser needs to carry those. The button that
// opens the dialog, its title, and the line for a chunk that fails to load stay in `languageCopy.boardReview`.

export const boardReviewCopy = {
  en: {
    intro:
      'Everyone who played in a week, newest first. Nothing waits for you: a result stands and a posted name and place show at once, and a link shows once its visitor has signed in with LinkedIn. Take off afterwards what should not be there.',
    loading: 'Loading the list…',
    loadError: 'The list could not be loaded.',
    retry: 'Try again',
    reload: 'Reload',
    empty: 'Nobody played in this week.',
    unreadable: (count: number) => `${count} rows could not be read and are not shown.`,
    changed:
      'That record changed or was deleted after the list loaded, so nothing was done. The list has reloaded: check it and try again.',
    failed: 'That did not work. Please try again.',
    done: 'Done. Places of other records update when you reload.',
    season: 'Week (any day of it)',
    pickSeason: 'Pick a day up to this week.',
    reportedTitle: 'Reports to look at',
    runsTitle: 'Runs, newest first',
    loadMore: 'Load more',
    visitor: (key: string) => `Visitor ${key}`,
    runStatuses: {
      issued: 'Started, no result',
      abandoned: 'Abandoned',
      scored: 'Scored',
      rejected: 'Rejected',
      flagged: 'Held by the old review, never counted',
    },
    best: 'Their record',
    noRecord: 'No record on this board',
    recordAbove: 'Same visitor, record shown above',
    place: (rank: number) => `Place ${rank}`,
    wouldBe: (rank: number) => `Not posted, would be place ${rank}`,
    removed: 'Removed from the board',
    recordNumber: (number: string) => `Record ${number}`,
    nameHidden: 'Name not shown',
    takenDown: 'Anonymised',
    appearanceHidden: 'Shows the default batter',
    noName: 'No name',
    portraitLabel: 'The character as posted',
    linkEncoded: 'Percent-encoded in the address',
    linkStatuses: {
      unverified: 'Nobody signed in for it, not public',
      verified: 'Signed in, public on a statue',
      reported: 'Hidden after a report',
    },
    verifiedName: (name: string) => `Signed in on LinkedIn as: ${name}`,
    verifiedNameNote: 'A sign-in proves an account, not that this address is its own. Compare the two names.',
    openProfile: 'Open profile',
    reportLine: (target: string, count: number) => `${target}: ${count} open`,
    reportMine: 'Says the profile is theirs',
    reportTargets: { name: 'Name', character: 'Character', link: 'Link' },
    resolutions: {
      name: { kept: 'Keep name', removed: 'Take name off' },
      character: { kept: 'Keep character', removed: 'Hide character' },
      link: { kept: 'Keep link', removed: 'Delete link' },
    },
    runDetail: 'Pitch by pitch',
    noFlags: 'No marks',
    flags: {
      'claimed-mismatch': 'Claimed totals differ from the server’s',
      'timing-too-precise': 'Timing too precise',
      'machine-values': 'The same error repeats',
      'calibration-offset': 'Unusual practice timing',
      'peak-at-floor': 'Peak speed at the floor',
      'speed-outside-practice': 'Swings far faster than practice',
      'height-missing': 'No bat height on any swing',
      'swing-duration': 'Implausible swing duration',
      'swing-speed': 'Implausible swing speed',
      'steady-power': 'Power too steady',
      'near-maximum': 'Distance near the maximum',
      'clock-skew': 'Client clock longer than the server’s',
      'podium-place': 'Would have taken a statue (old review)',
      'not-from-browser': 'Not sent like the game page',
      'too-fast': 'Result arrived too soon',
    },
    flagNotes: {
      'not-from-browser':
        'The result lacked the headers a browser’s fetch always sends. A script can add them, so this catches only lazy ones.',
    },
    facts: {
      claimed: 'Claimed',
      serverElapsed: 'Server time',
      clientElapsed: 'Client time',
      offset: 'Timing offset',
      peakSpeed: 'Peak speed',
      practiceMedian: 'Practice median',
      practiceSpeeds: 'Practice speeds',
    },
    pitch: {
      number: '#',
      type: 'Pitch',
      error: 'Error (ms)',
      power: 'Power',
      swing: 'Swing (ms)',
      height: 'Height error',
      speed: 'Speed',
      outcome: 'Result',
      distance: 'Distance',
    },
    pitchTypes: { fastball: 'Fastball', changeup: 'Changeup', curve: 'Curve' },
    remove: 'Remove from the board',
    restore: 'Put back on the board',
    hideName: 'Take name off',
    showName: 'Show name',
    hideAppearance: 'Hide character',
    showAppearance: 'Show character',
    removeLink: 'Delete link',
    takedown: 'Anonymise (takedown)',
    blockLinkedIn: 'Also block this LinkedIn profile from every record',
    confirmRemove: (name: string, number: string) =>
      `Remove ${name} (record ${number}) from the board? The next record moves up at once, and this visitor’s later runs on this board stay off it.`,
    confirmTakedown: (name: string, number: string, blocking: boolean) =>
      `Anonymise ${name} (record ${number})? Its name and link are deleted for good, its character is hidden from everyone, and the score keeps its place.${
        blocking ? ' The LinkedIn profile is blocked from every record too.' : ''
      }`,
    confirmRemoveLink: (name: string, number: string, blocking: boolean) =>
      `Delete the link of ${name} (record ${number})? ${
        blocking
          ? 'The LinkedIn profile is blocked from every record too.'
          : 'To show one again the visitor has to add it and sign in again.'
      }`,
    confirmShowName: (name: string, number: string) =>
      `The name ${name} (record ${number}) was refused by the name check or taken off. Show it anyway?`,
  },
  ko: {
    intro:
      '한 주 동안 경기한 사람을 최근 순으로 모두 보여 줘요. 미리 확인할 것은 없어요. 결과는 바로 인정되고, 올린 이름과 순위는 바로 보이며, 링크는 방문자가 LinkedIn에 로그인하면 보여요. 있으면 안 되는 것은 나중에 내려 주세요.',
    loading: '목록을 불러오는 중…',
    loadError: '목록을 불러오지 못했어요.',
    retry: '다시 시도',
    reload: '새로고침',
    empty: '이 주에는 경기한 사람이 없어요.',
    unreadable: (count: number) => `${count}줄을 읽지 못해 보여 주지 못했어요.`,
    changed:
      '목록을 불러온 뒤 그 기록이 바뀌었거나 지워져서 아무것도 하지 않았어요. 목록을 다시 불러왔으니 확인하고 다시 해 주세요.',
    failed: '처리하지 못했어요. 다시 시도해 주세요.',
    done: '처리했어요. 다른 기록의 순위는 새로고침하면 바뀌어요.',
    season: '주 (그 주의 아무 날)',
    pickSeason: '이번 주까지의 날짜를 골라 주세요.',
    reportedTitle: '확인할 신고',
    runsTitle: '경기, 최근 순',
    loadMore: '더 보기',
    visitor: (key: string) => `방문자 ${key}`,
    runStatuses: {
      issued: '시작만 하고 결과 없음',
      abandoned: '버린 판',
      scored: '점수 인정',
      rejected: '거절됨',
      flagged: '예전 검토에서 보류, 인정된 적 없음',
    },
    best: '이 방문자의 기록',
    noRecord: '이 주에 기록 없음',
    recordAbove: '같은 방문자, 기록은 위에 있어요',
    place: (rank: number) => `${rank}위`,
    wouldBe: (rank: number) => `올리지 않음, 올리면 ${rank}위`,
    removed: '순위에서 뺌',
    recordNumber: (number: string) => `기록 번호 ${number}`,
    nameHidden: '이름 안 보임',
    takenDown: '익명 처리됨',
    appearanceHidden: '공개 화면엔 기본 타자',
    noName: '이름 없음',
    portraitLabel: '올린 캐릭터 모습',
    linkEncoded: '주소에 퍼센트 인코딩이 있어요',
    linkStatuses: {
      unverified: '로그인한 사람 없음, 비공개',
      verified: '로그인 확인됨, 동상에 공개',
      reported: '신고로 숨김',
    },
    verifiedName: (name: string) => `LinkedIn에 로그인한 이름: ${name}`,
    verifiedNameNote:
      '로그인은 계정만 확인해 줄 뿐, 이 주소가 그 계정의 것인지는 알려 주지 않아요. 두 이름을 견주어 보세요.',
    openProfile: '프로필 열기',
    reportLine: (target: string, count: number) => `${target}: 신고 ${count}건`,
    reportMine: '본인 프로필이라는 신고',
    reportTargets: { name: '이름', character: '캐릭터', link: '링크' },
    resolutions: {
      name: { kept: '이름 유지', removed: '이름 내리기' },
      character: { kept: '캐릭터 유지', removed: '캐릭터 가리기' },
      link: { kept: '링크 유지', removed: '링크 삭제' },
    },
    runDetail: '공마다 자세히',
    noFlags: '표시 없음',
    flags: {
      'claimed-mismatch': '주장값이 서버 값과 달라요',
      'timing-too-precise': '타이밍이 너무 정확해요',
      'machine-values': '같은 오차가 되풀이돼요',
      'calibration-offset': '연습 타이밍이 이상해요',
      'peak-at-floor': '최고 속도가 바닥값이에요',
      'speed-outside-practice': '연습보다 훨씬 빠른 스윙',
      'height-missing': '스윙 높이 값이 없어요',
      'swing-duration': '스윙 시간이 이상해요',
      'swing-speed': '스윙 속도가 이상해요',
      'steady-power': '파워가 너무 고르게 나와요',
      'near-maximum': '비거리가 최대에 가까워요',
      'clock-skew': '클라이언트 시간이 서버보다 길어요',
      'podium-place': '동상 자리에 들 판이었어요 (예전 검토)',
      'not-from-browser': '경기 화면의 요청 같지 않아요',
      'too-fast': '결과가 너무 빨리 왔어요',
    },
    flagNotes: {
      'not-from-browser':
        '브라우저의 fetch가 항상 보내는 헤더가 없었어요. 스크립트도 넣을 수 있어서 허술한 것만 걸러요.',
    },
    facts: {
      claimed: '주장값',
      serverElapsed: '서버 경과',
      clientElapsed: '클라이언트 경과',
      offset: '보정 오프셋',
      peakSpeed: '개인 최고 속도',
      practiceMedian: '연습 중앙값',
      practiceSpeeds: '연습 속도',
    },
    pitch: {
      number: '#',
      type: '구종',
      error: '오차(ms)',
      power: '파워',
      swing: '스윙(ms)',
      height: '높이 오차',
      speed: '속도',
      outcome: '결과',
      distance: '비거리',
    },
    pitchTypes: { fastball: '직구', changeup: '체인지업', curve: '커브' },
    remove: '순위에서 빼기',
    restore: '순위에 되돌리기',
    hideName: '이름 내리기',
    showName: '이름 보이기',
    hideAppearance: '캐릭터 가리기',
    showAppearance: '캐릭터 되살리기',
    removeLink: '링크 삭제',
    takedown: '익명으로 바꾸기 (게시 중단)',
    blockLinkedIn: '이 LinkedIn 프로필도 모든 기록에서 막기',
    confirmRemove: (name: string, number: string) =>
      `이 기록을 순위에서 뺄까요? ${name} · 기록 번호 ${number}. 다음 기록이 바로 한 자리 올라오고, 이 방문자가 이 주에 다시 쳐도 순위에 오르지 않아요.`,
    confirmTakedown: (name: string, number: string, blocking: boolean) =>
      `이 기록을 익명으로 바꿀까요? ${name} · 기록 번호 ${number}. 이름과 링크는 지워져 돌아오지 않고, 캐릭터는 누구에게도 보이지 않아요. 점수와 순위는 그대로예요.${
        blocking ? ' 이 LinkedIn 프로필도 모든 기록에서 막아요.' : ''
      }`,
    confirmRemoveLink: (name: string, number: string, blocking: boolean) =>
      `이 기록의 링크를 지울까요? ${name} · 기록 번호 ${number}. ${
        blocking
          ? '이 LinkedIn 프로필도 모든 기록에서 막아요.'
          : '다시 보이려면 방문자가 링크를 다시 넣고 로그인해야 해요.'
      }`,
    confirmShowName: (name: string, number: string) =>
      `이름 검사에서 거절됐거나 내린 이름이에요: ${name} · 기록 번호 ${number}. 그래도 보일까요?`,
  },
} as const

export type BoardReviewCopy = (typeof boardReviewCopy)[keyof typeof boardReviewCopy]
