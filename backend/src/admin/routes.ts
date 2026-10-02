// 관리자 전용 API. 로그인한 사용자의 role이 admin일 때만 연다.
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { requireAdmin, requireUser, type AuthDeps } from "../auth/routes.js";
import { traineeStats } from "./trainee-stats.js";

export function createAdminRouter(db: DatabaseSync, auth: AuthDeps): express.Router {
  const router = express.Router();
  router.get("/api/admin/trainees", requireUser(auth), requireAdmin, (_req, res) => {
    res.json(traineeStats(db));
  });
  return router;
}
