import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { CheckpointEngine } from "../src/checkpoint/engine.js";
import { CheckpointRepository } from "../src/checkpoint/repository.js";
import { createCheckpointRouter } from "../src/checkpoint/routes.js";
import { CheckpointError, LlmUnavailableError, type CheckpointView } from "../src/checkpoint/types.js";
import { openDatabase } from "../src/db/database.js";
import { FakeEvaluator, FakeTutor, IRONMAKING, STEELMAKING } from "./checkpoint-fakes.js";

const USER = "u1";

function setup() {
  const repo = new CheckpointRepository(openDatabase(":memory:"));
  const evaluator = new FakeEvaluator();
  const tutor = new FakeTutor();
  let tick = 0;
  const engine = new CheckpointEngine({
    repo,
    evaluator,
    tutor,
    rubrics: [IRONMAKING, STEELMAKING],
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  });
  return { repo, evaluator, tutor, engine };
}

/** 시작 → "네" → 답변들. 마지막 응답을 돌려준다. */
async function runCheckpoint(engine: CheckpointEngine, answers: string[], user = USER): Promise<CheckpointView> {
  const { view } = await engine.start(user, "ironmaking");
  let last = await engine.respond(user, view.attempt_id, "네");
  for (const answer of answers) last = await engine.respond(user, view.attempt_id, answer);
  return last;
}

const texts = (view: CheckpointView) => view.tutor.map((u) => `${u.type}:${u.text}`);

test("정답 흐름: 모든 개념이 correct면 완료되고 다음 섹션이 열린다", async () => {
  const { engine, evaluator } = setup();

  const { created, view: started } = await engine.start(USER, "ironmaking");
  assert.ok(created);
  assert.equal(started.state, "awaiting_ready");
  assert.deepEqual(texts(started), ["intro:제선 질문 시작할게요, 준비됐나요?"]);

  const ready = await engine.respond(USER, started.attempt_id, "네");
  assert.equal(ready.state, "awaiting_answer");
  assert.deepEqual(ready.concept, { id: "a", name: "개념A", index: 1, total: 3 });
  assert.deepEqual(texts(ready), ["question:Q:a"]);

  const afterA = await engine.respond(USER, started.attempt_id, "correct");
  assert.deepEqual(texts(afterA), ["feedback:맞아요.", "question:Q:b"]);
  assert.deepEqual(afterA.progress.map((p) => p.status), ["done", "current", "pending"]);
  assert.equal(afterA.result, null);

  await engine.respond(USER, started.attempt_id, "correct");
  const done = await engine.respond(USER, started.attempt_id, "correct");
  assert.equal(done.state, "completed");
  assert.equal(done.concept, null);
  assert.equal(done.result?.understanding, 1);
  assert.equal(done.result?.unlocked, true);
  assert.deepEqual(done.result?.concepts.map((c) => [c.concept_id, c.score, c.final_verdict]), [
    ["a", 1, "correct"], ["b", 1, "correct"], ["c", 1, "correct"],
  ]);
  assert.match(done.tutor.at(-1)!.text, /이해도 100%.*제강 섹션이 열렸어요/);
  assert.deepEqual(evaluator.calls.map((c) => c.phase), ["initial", "initial", "initial"]);

  assert.equal(engine.sectionProgress(USER, "ironmaking").unlocked, true);
  assert.equal(engine.sectionProgress(USER, "steelmaking").open, true);
  await assert.rejects(engine.start(USER, "ironmaking"), (e) => e instanceof CheckpointError && e.status === 409);
});

test("partial → 부가 설명과 다른 각도 재확인 → 재확인 판정이 최종 점수", async () => {
  const { engine, evaluator, tutor } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");

  const partial = await engine.respond(USER, view.attempt_id, "partial@1");
  assert.equal(partial.state, "awaiting_recheck");
  assert.deepEqual(texts(partial), ["explanation:EX:a:1", "recheck_question:RQ:a"]);
  assert.deepEqual(tutor.calls.find((c) => c.kind === "recheck")?.extra, { previousQuestion: "Q:a" });

  const rechecked = await engine.respond(USER, view.attempt_id, "correct");
  assert.deepEqual(texts(rechecked), ["feedback:맞아요, 이번에는 정확해요.", "question:Q:b"]);
  assert.equal(evaluator.calls.at(-1)?.question, "RQ:a"); // 재확인 질문으로 채점

  await engine.respond(USER, view.attempt_id, "partial");
  const keyPoints = await engine.respond(USER, view.attempt_id, "partial");
  assert.equal(keyPoints.tutor[0]!.type, "key_points");
  assert.match(keyPoints.tutor[0]!.text, /개념B 핵심 1\n- 개념B 핵심 2/);

  const done = await engine.respond(USER, view.attempt_id, "correct");
  assert.deepEqual(done.result?.concepts.map((c) => c.score), [1, 0.5, 1]);
  assert.equal(done.result?.unlocked, true); // 2.5 / 3 ≥ 80%
  assert.deepEqual(evaluator.calls.map((c) => c.phase), ["initial", "recheck", "initial", "recheck", "initial"]);
});

test("assisted → 부가 설명 후 재확인 correct면 1점", async () => {
  const { engine, repo } = setup();
  const done = await runCheckpoint(engine, ["assisted", "correct", "correct", "correct"]);
  assert.equal(done.state, "completed");
  assert.equal(done.result?.concepts[0]!.score, 1);
  const row = repo.listResults(done.attempt_id).find((r) => r.concept_id === "a")!;
  assert.equal(row.verdict, "assisted");
  assert.equal(row.recheck_verdict, "correct");
  assert.equal(row.recheck_question, "RQ:a");
});

test("재확인 단계에서 평가자가 assisted를 내면 계약 위반으로 error 상태가 된다", async () => {
  const { engine } = setup();
  const view = await runCheckpoint(engine, ["wrong", "assisted"]);
  assert.equal(view.state, "error");
  assert.equal(view.tutor[0]!.type, "error");
});

test("80% 미달 → 재도전은 만점이 아닌 개념만 묻고, 맞힌 개념 점수와 오개념 해결을 반영한다", async () => {
  const { engine, evaluator, repo } = setup();
  const first = await runCheckpoint(engine, [
    "correct",
    "wrong|코크스가 불순물을 없앤다고 생각함", "wrong|여전히 불순물 제거로 설명함",
    "partial", "partial",
  ]);
  assert.equal(first.state, "completed");
  assert.equal(first.result?.understanding, 0.5);
  assert.equal(first.result?.unlocked, false);
  assert.deepEqual(first.result?.retry_concept_ids, ["b", "c"]);
  assert.match(first.tutor.at(-1)!.text, /이해도 50%.*섹션 처음으로.*개념B, 개념C/);

  // 첫 판정과 재확인에서 나온 오개념을 모두 기록한다.
  const recorded = repo.listMisconceptions(USER);
  assert.deepEqual(recorded.map((m) => [m.concept_id, m.phase, m.answer_text, m.summary, m.resolved]), [
    ["b", "initial", "wrong|코크스가 불순물을 없앤다고 생각함", "코크스가 불순물을 없앤다고 생각함", false],
    ["b", "recheck", "wrong|여전히 불순물 제거로 설명함", "여전히 불순물 제거로 설명함", false],
  ]);

  const progress = engine.sectionProgress(USER, "ironmaking");
  assert.equal(progress.unlocked, false);
  assert.deepEqual(progress.retry_concept_ids, ["b", "c"]);
  assert.equal(engine.sectionProgress(USER, "steelmaking").open, false);

  const { created, view: retry } = await engine.start(USER, "ironmaking");
  assert.ok(created);
  assert.equal(retry.kind, "retry");
  assert.deepEqual(retry.progress.map((p) => p.concept_id), ["b", "c"]);
  assert.match(retry.tutor[0]!.text, /어려웠던 개념 2개만/);

  evaluator.calls = [];
  await engine.respond(USER, retry.attempt_id, "네");
  await engine.respond(USER, retry.attempt_id, "correct");
  const done = await engine.respond(USER, retry.attempt_id, "correct");
  assert.deepEqual(evaluator.calls.map((c) => c.concept.concept_id), ["b", "c"]);
  assert.equal(done.result?.understanding, 1);
  assert.equal(done.result?.unlocked, true);
  assert.equal(done.result?.concepts[0]!.score, 1); // 첫 시도에서 맞힌 a 유지
  assert.ok(repo.listMisconceptions(USER).every((m) => m.resolved));
});

test("평가자 형식 오류 → error 상태 → retry-evaluation으로 같은 답변을 다시 채점", async () => {
  const { engine, evaluator, repo } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");

  evaluator.failNext = 1;
  const failed = await engine.respond(USER, view.attempt_id, "correct");
  assert.equal(failed.state, "error");
  assert.equal(failed.concept?.id, "a");
  await assert.rejects(engine.respond(USER, view.attempt_id, "correct"), (e) => e instanceof CheckpointError && e.status === 409);

  const resumed = await engine.retryEvaluation(USER, view.attempt_id);
  assert.equal(resumed.state, "awaiting_answer");
  assert.equal(resumed.concept?.id, "b");
  assert.equal(repo.listResults(view.attempt_id)[0]?.answer, "correct");
  const userMessages = repo.listMessages(view.attempt_id).filter((m) => m.role === "user").map((m) => m.text);
  assert.deepEqual(userMessages, ["네", "correct"]); // 다시 채점해도 답변은 한 번만 기록
});

test("LLM 연결 실패면 아무것도 저장하지 않아 같은 메시지를 다시 보낼 수 있다", async () => {
  const { engine, tutor, repo } = setup();
  const { view } = await engine.start(USER, "ironmaking");

  tutor.failNext = 1;
  await assert.rejects(engine.respond(USER, view.attempt_id, "네"), LlmUnavailableError);
  assert.equal(engine.get(USER, view.attempt_id).state, "awaiting_ready");
  await engine.respond(USER, view.attempt_id, "네");

  tutor.failNext = 1; // correct 판정 뒤 다음 질문 생성에서 실패
  await assert.rejects(engine.respond(USER, view.attempt_id, "correct"), LlmUnavailableError);
  assert.equal(repo.listResults(view.attempt_id).length, 0);
  const again = await engine.respond(USER, view.attempt_id, "correct");
  assert.equal(again.concept?.id, "b");
});

test("진행 중인 시도를 다시 시작하면 같은 시도를 대화 기록과 함께 돌려준다", async () => {
  const { engine } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");
  const resumed = await engine.start(USER, "ironmaking");
  assert.equal(resumed.created, false);
  assert.equal(resumed.view.attempt_id, view.attempt_id);
  assert.deepEqual(resumed.view.history?.map((m) => m.role), ["tutor", "user", "tutor"]);
});

test("잠긴 섹션은 403, 없는 시도·다른 사용자의 시도는 404, 겹친 요청은 409", async () => {
  const { engine, tutor } = setup();
  await assert.rejects(engine.start(USER, "steelmaking"), (e) => e instanceof CheckpointError && e.status === 403);
  await assert.rejects(engine.start(USER, "rolling"), (e) => e instanceof CheckpointError && e.status === 404);

  const { view } = await engine.start(USER, "ironmaking");
  assert.throws(() => engine.get("someone-else", view.attempt_id), (e) => e instanceof CheckpointError && e.status === 404);
  assert.throws(() => engine.get(USER, "missing"), (e) => e instanceof CheckpointError && e.status === 404);

  tutor.delay = 20;
  const results = await Promise.allSettled([
    engine.respond(USER, view.attempt_id, "네"),
    engine.respond(USER, view.attempt_id, "네"),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal((rejected.reason as CheckpointError).status, 409);
});

test("HTTP: 시작 201·재시작 200, 입력 오류 400, LLM 연결 실패 502", async (t) => {
  const { engine, tutor } = setup();
  const app = express();
  app.use(express.json());
  app.use(createCheckpointRouter(engine));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  const started = await post("/api/checkpoints", { section: "ironmaking" }, { "X-User-Id": "http-user" });
  assert.equal(started.status, 201);
  const view = (await started.json()) as CheckpointView;
  assert.equal((await post("/api/checkpoints", { section: "ironmaking" }, { "X-User-Id": "http-user" })).status, 200);

  assert.equal((await post("/api/checkpoints", { section: "mining" })).status, 400);
  assert.equal((await post("/api/checkpoints", { section: "ironmaking" }, { "X-User-Id": "bad id!" })).status, 400);
  assert.equal((await post(`/api/checkpoints/${view.attempt_id}/messages`, { text: " " }, { "X-User-Id": "http-user" })).status, 400);
  assert.equal((await fetch(`${base}/api/checkpoints/${view.attempt_id}`)).status, 404); // demo-user의 시도가 아님

  tutor.failNext = 1;
  const unavailable = await post(`/api/checkpoints/${view.attempt_id}/messages`, { text: "네" }, { "X-User-Id": "http-user" });
  assert.equal(unavailable.status, 502);
  assert.equal(((await unavailable.json()) as { code: string }).code, "LLM_UNAVAILABLE");

  const progress = await fetch(`${base}/api/sections/ironmaking/progress`, { headers: { "X-User-Id": "http-user" } });
  assert.equal(((await progress.json()) as { in_progress_attempt_id: string }).in_progress_attempt_id, view.attempt_id);
});
