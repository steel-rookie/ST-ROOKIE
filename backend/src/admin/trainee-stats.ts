// 관리자 화면의 신입사원 통계. 오개념은 개수만 내보내고 내용·답변 원문은 내보내지 않는다(본인만 봄).
// 체크포인트 기록(attempts, misconceptions 테이블)은 feature/checkpoint-api의 001_checkpoint.sql이 만든다.
// 그 테이블이 아직 없으면 checkpoint_data: false와 빈 기록을 돌려준다.
import type { DatabaseSync } from "node:sqlite";

export const SECTIONS = ["ironmaking", "steelmaking", "continuous_casting", "rolling"] as const;
export type Section = (typeof SECTIONS)[number];

export interface SectionStat {
  /** 마지막으로 끝낸 체크포인트의 이해도(0~1). */
  understanding: number;
  /** 한 번이라도 80% 이상으로 통과했는지. */
  passed: boolean;
  /** 끝낸 체크포인트 횟수(첫 시도 + 재도전). */
  attempts: number;
}

export interface TraineeStat {
  id: string;
  username: string;
  name: string;
  employee_no: string;
  created_at: string;
  last_activity: string | null;
  sections: Record<Section, SectionStat | null>;
  passed_sections: number;
  misconceptions: { open: number; resolved: number };
}

export interface TraineeStats {
  checkpoint_data: boolean;
  sections: readonly Section[];
  trainees: TraineeStat[];
}

export function traineeStats(db: DatabaseSync): TraineeStats {
  const users = db
    .prepare("SELECT id, username, name, employee_no, created_at FROM users WHERE role = 'trainee' ORDER BY username")
    .all();
  const checkpointData = hasTable(db, "attempts") && hasTable(db, "misconceptions");

  const trainees = users.map((u): TraineeStat => ({
    id: String(u.id),
    username: String(u.username),
    name: String(u.name),
    employee_no: String(u.employee_no),
    created_at: String(u.created_at),
    last_activity: null,
    sections: Object.fromEntries(SECTIONS.map((s) => [s, null])) as Record<Section, SectionStat | null>,
    passed_sections: 0,
    misconceptions: { open: 0, resolved: 0 },
  }));
  if (!checkpointData) return { checkpoint_data: false, sections: SECTIONS, trainees };

  const byId = new Map(trainees.map((t) => [t.id, t]));
  // 완료 순서대로 읽어서 마지막 시도의 이해도가 남게 한다.
  const done = db
    .prepare("SELECT user_id, section, understanding, unlocked FROM attempts WHERE state = 'completed' ORDER BY completed_at, created_at")
    .all();
  for (const row of done) {
    const t = byId.get(String(row.user_id));
    const section = String(row.section) as Section;
    if (!t || !SECTIONS.includes(section)) continue;
    const prev = t.sections[section];
    t.sections[section] = {
      understanding: Number(row.understanding ?? 0),
      passed: Boolean(prev?.passed) || Number(row.unlocked) === 1,
      attempts: (prev?.attempts ?? 0) + 1,
    };
  }

  const activity = db.prepare("SELECT user_id, MAX(updated_at) AS last FROM attempts GROUP BY user_id").all();
  for (const row of activity) {
    const t = byId.get(String(row.user_id));
    if (t) t.last_activity = row.last == null ? null : String(row.last);
  }

  const mis = db.prepare("SELECT user_id, resolved, COUNT(*) AS n FROM misconceptions GROUP BY user_id, resolved").all();
  for (const row of mis) {
    const t = byId.get(String(row.user_id));
    if (!t) continue;
    if (Number(row.resolved) === 1) t.misconceptions.resolved = Number(row.n);
    else t.misconceptions.open = Number(row.n);
  }

  for (const t of trainees) t.passed_sections = SECTIONS.filter((s) => t.sections[s]?.passed).length;
  return { checkpoint_data: true, sections: SECTIONS, trainees };
}

// PostgreSQL로 옮겨도 쓸 수 있게 시스템 테이블 대신 빈 조회로 테이블 존재를 확인한다.
export function hasTable(db: DatabaseSync, name: string): boolean {
  try {
    db.prepare(`SELECT 1 FROM ${name} WHERE 1 = 0`).all();
    return true;
  } catch {
    return false;
  }
}
