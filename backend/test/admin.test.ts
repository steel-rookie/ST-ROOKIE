import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import express from "express";
import { createAdminRouter } from "../src/admin/routes.js";
import { traineeStats } from "../src/admin/trainee-stats.js";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";

const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");
let db: DatabaseSync;
let server: ReturnType<express.Express["listen"]>;
let base = "";
let admin: User;
let kim: User;
let lee: User;

before(async () => {
  db = openDatabase(":memory:");
  const users = new UserRepository(db);
  admin = await users.create({ username: "admin01", password: "password123", name: "관리자", employee_no: "A1", role: "admin" });
  kim = await users.create({ username: "trainee01", password: "password123", name: "김신입", employee_no: "T1" });
  lee = await users.create({ username: "trainee02", password: "password123", name: "이신입", employee_no: "T2" });
  const app = express();
  app.use(createAdminRouter(db, { users, secret }));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const get = async (user?: User, path = "/api/admin/trainees") => {
  const headers: Record<string, string> = user ? { authorization: `Bearer ${await signToken(user, secret)}` } : {};
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, json: (await res.json()) as any };
};

test("only admins can read trainee stats", async () => {
  assert.equal((await get()).status, 401);
  assert.equal((await get(kim)).status, 403);
  assert.equal((await get(admin)).status, 200);
});

test("concept statistics require admin and come from completed trainee answers", async () => {
  assert.equal((await get(undefined, "/api/admin/concepts")).status, 401);
  assert.equal((await get(kim, "/api/admin/concepts")).status, 403);
  const before = await get(admin, "/api/admin/concepts");
  assert.equal(before.status, 200);
  assert.deepEqual(before.json.concepts, []);
  db.prepare("INSERT INTO attempts (id, user_id, section, state, understanding, unlocked, created_at, updated_at, completed_at, kind, concept_ids) VALUES ('concept-test', ?, 'ironmaking', 'completed', 0.5, 0, '2026-10-01', '2026-10-01', '2026-10-01', 'first', '[\"hot_stove\"]')").run(lee.id);
  db.prepare("INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, recheck_verdict, created_at, updated_at) VALUES ('concept-test', 'hot_stove', 'q', 'a', 'wrong', 'partial', '2026-10-01', '2026-10-01')").run();
  const after = await get(admin, "/api/admin/concepts");
  assert.deepEqual(after.json.concepts, [{ section: "ironmaking", concept_id: "hot_stove", asked: 1, partial: 0, wrong: 1, assisted: 0, final_wrong: 0, open: 0 }]);
  db.prepare("DELETE FROM concept_results WHERE attempt_id = 'concept-test'").run();
  db.prepare("DELETE FROM attempts WHERE id = 'concept-test'").run();
});

test("without checkpoint tables, trainees are listed with empty records", () => {
  // 001_checkpoint.sql 없이 users만 있는 DB.
  const bare = new DatabaseSync(":memory:");
  bare.exec("CREATE TABLE users (id TEXT, username TEXT, password_hash TEXT, role TEXT, name TEXT, employee_no TEXT, created_at TEXT)");
  bare.prepare("INSERT INTO users VALUES ('u1', 'trainee01', 'x', 'trainee', '김신입', 'T1', '2026-10-01')").run();
  const stats = traineeStats(bare);
  assert.equal(stats.checkpoint_data, false);
  assert.equal(stats.trainees[0].sections.ironmaking, null);
  assert.deepEqual(stats.trainees[0].misconceptions, { open: 0, resolved: 0 });
});

test("with no records yet, every trainee has empty sections", async () => {
  const { json } = await get(admin);
  assert.equal(json.checkpoint_data, true);
  assert.deepEqual(json.trainees.map((t: { username: string }) => t.username), ["trainee01", "trainee02"]);
  assert.equal(json.trainees[0].passed_sections, 0);
});

test("with checkpoint tables, stats use the last completed attempt and count misconceptions only", () => {
  const attempt = db.prepare("INSERT INTO attempts (id, user_id, section, state, understanding, unlocked, created_at, updated_at, completed_at, kind, concept_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'first', '[]')");
  attempt.run("a1", kim.id, "ironmaking", "completed", 0.6, 0, "2026-10-01T01:00Z", "2026-10-01T01:10Z", "2026-10-01T01:10Z");
  attempt.run("a2", kim.id, "ironmaking", "completed", 0.9, 1, "2026-10-01T02:00Z", "2026-10-01T02:10Z", "2026-10-01T02:10Z");
  attempt.run("a3", kim.id, "steelmaking", "in_progress", null, null, "2026-10-01T03:00Z", "2026-10-01T03:05Z", null);
  const mis = db.prepare("INSERT INTO misconceptions (id, user_id, answer_text, summary, resolved, created_at, section, concept_id, source) VALUES (?, ?, ?, ?, ?, ?, 'ironmaking', 'hot_stove', 'checkpoint')");
  mis.run("m1", kim.id, "열풍로가 쇳물을 데워요", "열풍로 역할 오해", 0, "2026-10-01");
  mis.run("m2", kim.id, "코크스는 연료", "환원제 역할 누락", 1, "2026-10-01");

  const stats = traineeStats(db);
  const k = stats.trainees.find((t) => t.username === "trainee01")!;
  assert.equal(stats.checkpoint_data, true);
  assert.deepEqual(k.sections.ironmaking, { understanding: 0.9, passed: true, attempts: 2 });
  assert.equal(k.sections.steelmaking, null); // 진행 중인 시도는 세지 않는다
  assert.equal(k.passed_sections, 1);
  assert.equal(k.last_activity, "2026-10-01T03:05Z");
  assert.deepEqual(k.misconceptions, { open: 1, resolved: 1 });
  assert.ok(!JSON.stringify(stats).includes("열풍로가 쇳물을")); // 답변 원문은 내보내지 않는다

  const l = stats.trainees.find((t) => t.username === "trainee02")!;
  assert.equal(l.passed_sections, 0);
  assert.equal(l.last_activity, null);
});
