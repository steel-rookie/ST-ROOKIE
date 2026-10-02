// 개인 페이지 저장소. SQL은 이 파일에만 둔다.
import type { DatabaseSync } from "node:sqlite";
import type { Section } from "../checkpoint/types.js";
import { MISCONCEPTION_SOURCE_LABEL, type MisconceptionSource } from "../learning/labels.js";

export interface MyMisconception {
  id: string;
  section: Section;
  concept_id: string;
  source: MisconceptionSource;
  /** 화면 라벨: 학습 모드는 "대화 중 감지됨", 체크포인트는 "이해도 확인". */
  label: (typeof MISCONCEPTION_SOURCE_LABEL)[MisconceptionSource];
  summary: string;
  /** 오개념이 드러난 본인의 답변(학습 모드는 질문) 원문. */
  answer_text: string;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
}

export class MeRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** 한 사용자의 오개념. 최근 것부터. section을 주면 그 섹션만. */
  listMisconceptions(userId: string, section?: Section): MyMisconception[] {
    const rows = section
      ? this.db.prepare("SELECT * FROM misconceptions WHERE user_id = ? AND section = ? ORDER BY created_at DESC, id").all(userId, section)
      : this.db.prepare("SELECT * FROM misconceptions WHERE user_id = ? ORDER BY created_at DESC, id").all(userId);
    return rows.map((row) => {
      const source: MisconceptionSource = row.source === "learning" ? "learning" : "checkpoint";
      return {
        id: String(row.id),
        section: row.section as Section,
        concept_id: String(row.concept_id),
        source,
        label: MISCONCEPTION_SOURCE_LABEL[source],
        summary: String(row.summary),
        answer_text: String(row.answer_text),
        resolved: Number(row.resolved) === 1,
        created_at: String(row.created_at),
        resolved_at: row.resolved_at == null ? null : String(row.resolved_at),
      };
    });
  }
}
