// 관리자 화면의 개념별 통계. 신입사원이 끝낸 체크포인트의 첫 판정 분포와 미해결 오개념 개수만 낸다.
// 답변 원문·오개념 설명·사용자 id는 내보내지 않는다(오개념 내용은 본인만 봄).
// 체크포인트 테이블(attempts, concept_results)이 아직 없으면 빈 목록을 돌려준다.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { hasTable, SECTIONS, type Section } from "./trainee-stats.js";

export interface ConceptStat {
  section: Section;
  concept_id: string;
  /** 첫 질문을 받은 횟수(재도전 시도 포함). */
  asked: number;
  /** 첫 판정별 개수. */
  partial: number;
  wrong: number;
  assisted: number;
  /** 재확인 판정도 wrong이라 0점으로 끝난 횟수. */
  final_wrong: number;
  /** 이 개념의 미해결 오개념 수(신입사원 전체 합). */
  open: number;
}

export interface ConceptStats {
  concepts: ConceptStat[];
}

export function conceptStats(db: DatabaseSync, section?: Section): ConceptStats {
  if (!hasTable(db, "attempts") || !hasTable(db, "concept_results")) return { concepts: [] };

  const params: SQLInputValue[] = section ? [section] : [];
  const rows = db
    .prepare(
      `SELECT a.section, r.concept_id,
         COUNT(*) AS asked,
         SUM(CASE WHEN r.verdict = 'partial' THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN r.verdict = 'wrong' THEN 1 ELSE 0 END) AS wrong,
         SUM(CASE WHEN r.verdict = 'assisted' THEN 1 ELSE 0 END) AS assisted,
         SUM(CASE WHEN r.recheck_verdict = 'wrong' THEN 1 ELSE 0 END) AS final_wrong
       FROM concept_results r
       JOIN attempts a ON a.id = r.attempt_id
       JOIN users u ON u.id = a.user_id
       WHERE a.state = 'completed' AND u.role = 'trainee'${section ? " AND a.section = ?" : ""}
       GROUP BY a.section, r.concept_id`,
    )
    .all(...params);

  const open = new Map<string, number>();
  if (hasTable(db, "misconceptions")) {
    const mis = db
      .prepare(
        `SELECT m.section, m.concept_id, COUNT(*) AS n
         FROM misconceptions m
         JOIN users u ON u.id = m.user_id
         WHERE m.resolved = 0 AND u.role = 'trainee'
         GROUP BY m.section, m.concept_id`,
      )
      .all();
    for (const row of mis) open.set(`${row.section}/${row.concept_id}`, Number(row.n));
  }

  const concepts = rows
    .filter((row) => SECTIONS.includes(String(row.section) as Section))
    .map((row): ConceptStat => ({
      section: String(row.section) as Section,
      concept_id: String(row.concept_id),
      asked: Number(row.asked),
      partial: Number(row.partial),
      wrong: Number(row.wrong),
      assisted: Number(row.assisted),
      final_wrong: Number(row.final_wrong),
      open: open.get(`${row.section}/${row.concept_id}`) ?? 0,
    }))
    .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.concept_id.localeCompare(b.concept_id));
  return { concepts };
}
