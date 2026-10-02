// 개인 페이지 API. 로그인한 사용자 본인의 기록만 돌려준다(CLAUDE.md '오개념 기록': 본인 것만).
// 오개념은 학습 모드에서 감지한 것(source=learning)과 체크포인트에서 나온 것을 함께 주고, 출처를 라벨로 구분한다(docs/learning-mode.md '개인 페이지 표시').
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { requireUser, type AuthDeps } from "../auth/routes.js";
import type { User } from "../auth/users.js";
import { SECTION_ORDER, type Section } from "../checkpoint/types.js";

export const SOURCE_LABEL = { learning: "대화 중 감지됨", checkpoint: "이해도 확인" } as const;

export interface MyMisconception {
  id: string;
  section: Section;
  concept_id: string;
  source: keyof typeof SOURCE_LABEL;
  /** 화면 라벨: 학습 모드는 "대화 중 감지됨", 체크포인트는 "이해도 확인". */
  label: (typeof SOURCE_LABEL)[keyof typeof SOURCE_LABEL];
  summary: string;
  /** 오개념이 드러난 본인의 답변(학습 모드는 질문) 원문. */
  answer_text: string;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
}

/** 한 사용자의 오개념. 최근 것부터. section을 주면 그 섹션만. */
export function listMyMisconceptions(db: DatabaseSync, userId: string, section?: Section): MyMisconception[] {
  const rows = section
    ? db.prepare("SELECT * FROM misconceptions WHERE user_id = ? AND section = ? ORDER BY created_at DESC, id").all(userId, section)
    : db.prepare("SELECT * FROM misconceptions WHERE user_id = ? ORDER BY created_at DESC, id").all(userId);
  return rows.map((row) => {
    const source = row.source === "learning" ? "learning" : "checkpoint";
    return {
      id: String(row.id),
      section: row.section as Section,
      concept_id: String(row.concept_id),
      source,
      label: SOURCE_LABEL[source],
      summary: String(row.summary),
      answer_text: String(row.answer_text),
      resolved: Number(row.resolved) === 1,
      created_at: String(row.created_at),
      resolved_at: row.resolved_at == null ? null : String(row.resolved_at),
    };
  });
}

const Query = z.object({ section: z.enum(SECTION_ORDER as [Section, ...Section[]]).optional() });

export function createMeRouter(db: DatabaseSync, auth: AuthDeps): express.Router {
  const router = express.Router();
  // 로그인이 필요하다. 다른 사람의 기록은 어떤 값을 넣어도 볼 수 없다(사용자는 토큰으로만 정한다).
  router.get("/api/me/misconceptions", requireUser(auth), (req, res) => {
    const query = Query.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "알 수 없는 섹션입니다." });
      return;
    }
    const user = res.locals.user as User;
    res.json({ misconceptions: listMyMisconceptions(db, user.id, query.data.section) });
  });
  return router;
}
