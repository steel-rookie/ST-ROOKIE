// 개인 페이지 API. 로그인한 사용자 본인의 기록만 돌려준다(CLAUDE.md '오개념 기록': 본인 것만).
// 오개념은 학습 모드에서 감지한 것(source=learning)과 체크포인트에서 나온 것을 함께 주고, 출처를 라벨로 구분한다(docs/learning-mode.md '개인 페이지 표시').
// SQL은 me/repository.ts에 둔다.
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { requireUser, type AuthDeps } from "../auth/routes.js";
import type { User } from "../auth/users.js";
import { SECTION_ORDER, type Section } from "../checkpoint/types.js";
import { traineeStats } from "../admin/trainee-stats.js";
import { MeRepository } from "./repository.js";

const Query = z.object({ section: z.enum(SECTION_ORDER as [Section, ...Section[]]).optional() });

export function createMeRouter(db: DatabaseSync, auth: AuthDeps): express.Router {
  const router = express.Router();
  const repo = new MeRepository(db);
  // 로그인이 필요하다. 다른 사람의 기록은 어떤 값을 넣어도 볼 수 없다(사용자는 토큰으로만 정한다).
  router.get("/api/me/misconceptions", requireUser(auth), (req, res) => {
    const query = Query.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "알 수 없는 섹션입니다." });
      return;
    }
    const user = res.locals.user as User;
    res.json({ misconceptions: repo.listMisconceptions(user.id, query.data.section) });
  });
  router.get("/api/me/dashboard", requireUser(auth), (_req, res) => {
    const user = res.locals.user as User;
    if (user.role !== "trainee") {
      res.status(403).json({ error: "신입사원 계정만 볼 수 있습니다.", code: "TRAINEE_ONLY" });
      return;
    }
    const stats = traineeStats(db);
    const trainee = stats.trainees.find((item) => item.id === user.id);
    if (!trainee) {
      res.status(404).json({ error: "계정을 찾을 수 없습니다." });
      return;
    }
    const rows = repo.conceptResults(user.id);
    const seen = new Set<string>();
    const review_concepts = rows.flatMap((row) => {
      const section = String(row.section);
      const concept_id = String(row.concept_id);
      const key = `${section}:${concept_id}`;
      if (seen.has(key)) return [];
      seen.add(key);
      if (row.verdict === "correct" || row.recheck_verdict === "correct") return [];
      return [{ section, concept_id, verdict: String(row.verdict),
        recheck_verdict: row.recheck_verdict == null ? null : String(row.recheck_verdict),
        updated_at: String(row.updated_at) }];
    }).slice(0, 8);
    res.json({ checkpoint_data: stats.checkpoint_data, sections: stats.sections,
      trainee, review_concepts, misconceptions: repo.listMisconceptions(user.id) });
  });
  return router;
}
