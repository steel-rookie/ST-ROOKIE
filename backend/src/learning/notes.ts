// 학습자 메모: 학습 모드에서 모은 정보를 체크포인트에 넘기는 계약. 체크포인트 엔진은 CheckpointEngine.start()·respond()의
// options.notes로 이 타입을 받는다. 타입과 buildLearnerNotes 시그니처는 고정이고(바꾸려면 체크포인트 담당과 먼저 합의),
// 구현은 학습 모드에서 채운다. 설계는 docs/learning-mode.md '학습자 메모'.
import type { Section } from "../checkpoint/types.js";
import type { OpenMisconception } from "./repository.js";

export interface LearnerNotes {
  /** 개념을 물을 순서(concept_id). 루브릭에 있는 개념만 쓴다. 없으면 루브릭 순서. */
  conceptOrder?: string[];
  /** 체크포인트 튜터에게 줄 추가 컨텍스트(예: 학습 모드에서 감지한 오개념 요약). 평가자에게는 넘기지 않는다. */
  context?: string;
}

/** 메모를 만들 때 읽는 기록. 서버는 LearningRepository를 넘긴다. */
export interface LearnerNotesSource {
  openMisconceptions(userId: string, section: Section): OpenMisconception[];
}

/** context에 넣는 미해결 오개념 수(최근 것부터, 개념당 하나). */
export const MAX_NOTE_ITEMS = 5;

const SOURCE_LABEL: Record<OpenMisconception["source"], string> = { learning: "대화 중 감지됨", checkpoint: "이해도 확인" };

let notesSource: LearnerNotesSource | null = null;

/** 서버 시작 때 한 번 부른다. buildLearnerNotes의 시그니처가 고정이라 기록 저장소를 여기서 받는다. null이면 빈 메모로 돌아간다. */
export function useLearnerNotesSource(source: LearnerNotesSource | null): void {
  notesSource = source;
}

/**
 * 사용자의 섹션 학습 기록으로 학습자 메모를 만든다.
 * - context: 이 섹션의 미해결 오개념(학습 모드·체크포인트 모두)을 최근 것부터 개념당 하나씩 최대 5개 요약한다.
 * - conceptOrder: 루브릭 순서를 유지하기로 했으므로(docs/learning-mode.md 결정 사항) 넣지 않는다.
 * 저장소가 없거나 미해결 오개념이 없으면 빈 메모를 돌려준다(체크포인트 동작에 영향 없음).
 */
export async function buildLearnerNotes(userId: string, section: Section): Promise<LearnerNotes> {
  if (!notesSource) return {};
  const latestByConcept = new Map<string, OpenMisconception>();
  for (const m of notesSource.openMisconceptions(userId, section)) {
    const prev = latestByConcept.get(m.concept_id);
    if (!prev || m.created_at >= prev.created_at) latestByConcept.set(m.concept_id, m);
  }
  const items = [...latestByConcept.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, MAX_NOTE_ITEMS);
  if (items.length === 0) return {};
  const lines = items.map((m) => `- ${m.concept_id} (${SOURCE_LABEL[m.source]}): ${m.summary}`);
  return { context: ["이 학습자가 아직 헷갈리는 내용입니다. 관련 개념을 설명할 때 이 오해를 짚어 주세요.", ...lines].join("\n") };
}
