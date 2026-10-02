// 개인 페이지 API: 본인 오개념만, 출처 라벨 포함.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import { createMeRouter } from "../src/me/routes.js";

const secret = new TextEncoder().encode("me-test-secret-me-test-secret-me-test-secret");
const db = openDatabase(":memory:");
let server: ReturnType<express.Express["listen"]>;
let base = "";
let kim: User;
let lee: User;

before(async () => {
  const users = new UserRepository(db);
  kim = await users.create({ username: "trainee01", password: "password123", name: "김신입", employee_no: "T1" });
  lee = await users.create({ username: "trainee02", password: "password123", name: "이신입", employee_no: "T2" });
  const insert = db.prepare(
    "INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, resolved, resolved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run("m1", kim.id, "ironmaking", "coke_reduction", "learning", "코크스가 불순물 없애는 거죠?", "코크스를 불순물 제거로 앎", 0, null, "2026-10-02T01:00:00Z");
  insert.run("m2", kim.id, "ironmaking", "sinter_purpose", "checkpoint", "소결은 쇳물 만드는 거예요", "소결 목적 오해", 1, "2026-10-02T03:00:00Z", "2026-10-02T02:00:00Z");
  insert.run("m3", kim.id, "steelmaking", "bof", "checkpoint", "산소로 철을 태워요", "산화 대상 오해", 0, null, "2026-10-02T04:00:00Z");
  insert.run("m4", lee.id, "ironmaking", "coke_reduction", "learning", "다른 사람 답변", "다른 사람", 0, null, "2026-10-02T05:00:00Z");

  const app = express();
  app.use(createMeRouter(db, { users, secret }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const get = async (path: string, user?: User) => {
  const headers: Record<string, string> = user ? { authorization: `Bearer ${await signToken(user, secret)}` } : {};
  const res = await fetch(base + path, { headers });
  return { status: res.status, json: (await res.json()) as any };
};

test("본인 오개념만 최근 것부터, 출처 라벨과 해결 여부를 함께 준다", async () => {
  const { status, json } = await get("/api/me/misconceptions", kim);
  assert.equal(status, 200);
  assert.deepEqual(json.misconceptions.map((m: any) => [m.id, m.label, m.resolved]), [
    ["m3", "이해도 확인", false],
    ["m2", "이해도 확인", true],
    ["m1", "대화 중 감지됨", false],
  ]);
  assert.equal(json.misconceptions[2].answer_text, "코크스가 불순물 없애는 거죠?");
  assert.ok(!JSON.stringify(json).includes("다른 사람"));
});

test("section으로 거르고, 모르는 섹션은 400", async () => {
  const { json } = await get("/api/me/misconceptions?section=ironmaking", kim);
  assert.deepEqual(json.misconceptions.map((m: any) => m.id), ["m2", "m1"]);
  assert.equal((await get("/api/me/misconceptions?section=nope", kim)).status, 400);
});

test("로그인이 필요하다(토큰 없으면 401)", async () => {
  const { status, json } = await get("/api/me/misconceptions");
  assert.equal(status, 401);
  assert.equal(json.code, "AUTH_REQUIRED");
});
