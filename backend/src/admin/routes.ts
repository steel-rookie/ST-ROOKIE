// 관리자 전용 API. 로그인한 사용자의 role이 admin일 때만 연다.
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { AdminSummaryFormatError, type AdminSummarizer } from "../../../llm/src/admin-summary.js";
import { requireAdmin, requireUser, type AuthDeps } from "../auth/routes.js";
import { LlmUnavailableError, SECTION_ORDER, type Section } from "../checkpoint/types.js";
import type { Rubric } from "../rubrics.js";
import { UsageLimitError } from "../usage.js";
import { AiSummaryService } from "./ai-summary.js";
import { conceptStats } from "./concept-stats.js";
import { traineeStats } from "./trainee-stats.js";

export interface AdminOptions {
  /** 관리자 대시보드 AI 요약. 없으면 GET /api/admin/ai-summary가 503(LLM_UNAVAILABLE)을 준다. */
  summarizer?: AdminSummarizer;
  /** 테스트용. 기본은 final 루브릭. */
  rubrics?: () => readonly Rubric[];
}

/** ?section=을 확인한다. 틀리면 400을 보내고 null. */
function sectionParam(req: express.Request, res: express.Response): Section | undefined | null {
  const section = req.query.section;
  if (section !== undefined && !SECTION_ORDER.includes(section as Section)) {
    res.status(400).json({ error: `section은 ${SECTION_ORDER.join(", ")} 중 하나여야 해요.`, code: "INVALID_SECTION" });
    return null;
  }
  return section as Section | undefined;
}

export function createAdminRouter(db: DatabaseSync, auth: AuthDeps, options: AdminOptions = {}): express.Router {
  const router = express.Router();
  const summaries = options.summarizer ? new AiSummaryService(db, options.summarizer, options.rubrics) : null;
  router.get("/api/admin/trainees", requireUser(auth), requireAdmin, (_req, res) => {
    res.json(traineeStats(db));
  });
  router.get("/api/admin/concepts", requireUser(auth), requireAdmin, (req, res) => {
    const section = sectionParam(req, res);
    if (section === null) return;
    res.json(conceptStats(db, section, options.rubrics?.()));
  });
  router.get("/api/admin/ai-summary", requireUser(auth), requireAdmin, async (req, res) => {
    const section = sectionParam(req, res);
    if (section === null) return;
    const unavailable = { error: "AI 요약을 만들지 못했어요. 잠시 후 다시 시도해 주세요.", code: "LLM_UNAVAILABLE" };
    if (!summaries) {
      res.status(503).json(unavailable);
      return;
    }
    try {
      res.json(await summaries.summarize(section));
    } catch (error) {
      if (error instanceof UsageLimitError) {
        res.status(429).json({ error: `오늘 쓸 수 있는 LLM 호출(${error.limit}회)을 다 썼어요.`, code: "USAGE_LIMIT" });
      } else if (error instanceof LlmUnavailableError) {
        res.status(error.status).json(unavailable);
      } else if (error instanceof AdminSummaryFormatError) {
        console.error(error.message);
        res.status(502).json(unavailable);
      } else {
        console.error(error);
        res.status(500).json({ error: "서버 오류가 발생했습니다." });
      }
    }
  });
  return router;
}
