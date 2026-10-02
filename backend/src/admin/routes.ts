// 관리자 전용 API. 로그인한 사용자의 role이 admin일 때만 연다.
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { requireAdmin, requireUser, type AuthDeps } from "../auth/routes.js";
import { conceptStats } from "./concept-stats.js";
import { SECTIONS, traineeStats, type Section } from "./trainee-stats.js";

export function createAdminRouter(db: DatabaseSync, auth: AuthDeps): express.Router {
  const router = express.Router();
  router.get("/api/admin/trainees", requireUser(auth), requireAdmin, (_req, res) => {
    res.json(traineeStats(db));
  });
  router.get("/api/admin/concepts", requireUser(auth), requireAdmin, (req, res) => {
    const section = req.query.section;
    if (section !== undefined && !SECTIONS.includes(section as Section)) {
      res.status(400).json({ error: `section은 ${SECTIONS.join(", ")} 중 하나여야 해요.`, code: "INVALID_SECTION" });
      return;
    }
    res.json(conceptStats(db, section as Section | undefined));
  });
  return router;
}
