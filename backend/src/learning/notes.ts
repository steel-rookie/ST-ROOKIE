// 학습자 메모: 학습 모드에서 모은 정보를 체크포인트에 넘기는 계약. 체크포인트 엔진은 CheckpointEngine.start()·respond()의
// options.notes로 이 타입을 받는다. 타입과 buildLearnerNotes 시그니처는 고정이고(바꾸려면 체크포인트 담당과 먼저 합의),
// 구현은 학습 모드에서 채운다. 설계는 docs/learning-mode.md.
import type { Section } from "../checkpoint/types.js";

export interface LearnerNotes {
  /** 개념을 물을 순서(concept_id). 루브릭에 있는 개념만 쓴다. 없으면 루브릭 순서. */
  conceptOrder?: string[];
  /** 체크포인트 튜터에게 줄 추가 컨텍스트(예: 학습 모드에서 감지한 오개념 요약). 평가자에게는 넘기지 않는다. */
  context?: string;
}

/**
 * 사용자의 섹션 학습 기록으로 학습자 메모를 만든다.
 * TODO(학습 모드): 학습 모드 대화와 오개념(misconceptions.source = 'learning')을 읽어 conceptOrder·context를 채운다.
 * 지금은 빈 메모를 돌려준다(체크포인트 동작에 영향 없음).
 */
export async function buildLearnerNotes(_userId: string, _section: Section): Promise<LearnerNotes> {
  return {};
}
