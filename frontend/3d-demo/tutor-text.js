// 튜터 패널(학습 모드·이해도 확인)의 화면 문구. 탭 이름·버튼·배지·안내 문장은 여기서만 바꾼다.
// checkpoint-chat.js, api-client.js가 읽는다. 설계: docs/checkpoint-integration.md

export const TEXT = {
  tabs: {
    learning: '학습',
    checkpoint: '이해도 확인',
  },
  badges: {
    passed: '단련 완료',
    notPassed: '미통과',
  },
  buttons: {
    start: '시작',
    resume: '이어서 하기',
    retryAttempt: '재도전',
    ready: '준비됐어요',
    retryEvaluation: '다시 채점하기',
    send: '보내기',
    close: '닫기',
    login: '로그인',
  },
  // 체크포인트 진입 상태(섹션별).
  entry: {
    site: '공정을 고르면 그 공정의 이해도 확인을 시작할 수 있어요.',
    login: '로그인하면 이해도 확인을 할 수 있어요.',
    checking: '확인 중',
    notReady: '준비 중',
    offline: '연결 안 됨',
    locked: '잠김 · 앞 공정의 이해도 확인을 통과해야 열려요',
    passed: (percent) => `통과 · ${percent}%`,
    inProgress: '진행 중',
    retry: (count) => `재도전 · 개념 ${count}개`,
    notStarted: '시작 전',
  },
  // 진행 중 화면.
  title: (sectionName, isRetry) => `이해도 확인 · ${sectionName}${isRetry ? ' (재도전)' : ''}`,
  stage: {
    ready: '준비',
    retryReady: '재도전 준비',
    concept: (index, total) => `개념 ${index}/${total}`,
    recheck: '재확인',
    error: '채점 오류',
    done: '완료',
  },
  readyHint: {
    first: '준비되면 시작할게요',
    retry: '지난번에 어려웠던 개념만 다시 물어볼게요',
  },
  doneHint: '모든 개념을 확인했어요',
  placeholder: {
    ready: '준비됐어요를 누르거나 입력하세요',
    answer: '답변을 입력하세요',
    error: '다시 채점하기를 눌러 주세요',
  },
  // 튜터 메시지 종류별 머리말(서버 Utterance.type).
  messageLabels: {
    intro: '튜터',
    question: '질문',
    recheck_question: '다른 각도로 다시 물어볼게요',
    explanation: '설명',
    feedback: '확인',
    key_points: '핵심 정리',
    result: '결과',
    error: '채점 오류',
  },
  defaultMessageLabel: '튜터',
  verdicts: {
    correct: '맞음',
    partial: '부분',
    wrong: '틀림',
  },
  result: {
    score: (verdictLabel, score) => `${verdictLabel} · ${score}점`,
    threshold: (percent) => `기준 ${percent}%`,
    failed: (percent) => `${percent}% 미달 · 공정을 다시 살펴본 뒤 재도전해요`,
    allDone: '통과 · 모든 공정을 마쳤어요',
    nextOpened: (name) => `통과 · ${name} 이해도 확인이 열렸어요`,
    nextNotReady: '통과 · 다음 공정은 준비 중이에요',
  },
  // 체크포인트 진행 중 학습 탭에 보이는 안내.
  learningLocked: '이해도 확인을 마치면 다시 질문할 수 있어요.',
  // 요청 오류 안내(api-client.js).
  errors: {
    network: '서버에 연결하지 못했어요. 서버가 켜져 있는지 확인한 뒤 다시 시도해 주세요.',
    tokenInvalid: '로그인이 만료됐어요. 다시 로그인해 주세요.',
    loginRequired: '로그인이 필요해요. 로그인한 뒤 다시 시도해 주세요.',
    passcode: '접속 비밀번호가 맞지 않아요. 진행자에게 받은 비밀번호를 확인해 주세요.',
    usageLimit: '오늘 쓸 수 있는 튜터 호출을 다 썼어요. 내일 다시 하거나 진행자에게 알려 주세요.',
    server: '튜터 서버에 잠시 문제가 있어요. 잠시 후 다시 시도해 주세요.',
    unknown: '요청을 처리하지 못했어요. 다시 시도해 주세요.',
  },
};
